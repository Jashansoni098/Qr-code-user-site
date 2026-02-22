import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { 
    doc, getDoc, collection, onSnapshot, addDoc, 
    query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= GLOBAL STATE ================= */

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`platto_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup";
let userUID = "";
let userPoints = 0;
let isRedeeming = false;

let appliedCoupon = null;
let couponDiscount = 0;

const setUI = (id, val) => {
    const el = document.getElementById(id);
    if(el) el.innerText = val;
};

const showEl = (id, show = true) => {
    const el = document.getElementById(id);
    if(el) el.style.display = show ? "block" : "none";
};

const showFlex = (id, show = true) => {
    const el = document.getElementById(id);
    if(el) el.style.display = show ? "flex" : "none";
};

/* ================= INIT ================= */

async function init(){

    if(!resId){
        document.body.innerHTML = "<h2 style='text-align:center;padding:100px;'>Invalid QR</h2>";
        return;
    }

    const snap = await getDoc(doc(db,"restaurants",resId));
    if(snap.exists()){
        restaurantData = snap.data();
        renderBranding();
    }

    onAuthStateChanged(auth, async (user)=>{
        if(user){
            userUID = user.uid;
            onSnapshot(doc(db,"users",userUID),(u)=>{
                if(u.exists()){
                    userPoints = u.data().points || 0;
                    updatePointsUI();
                }
            });
        }else{
            userUID = localStorage.getItem('guest_id') || "g_"+Date.now();
            localStorage.setItem('guest_id',userUID);
        }
    });

    updateCartUI();
}

init();

/* ================= BRANDING + CHEF FIX ================= */

function renderBranding(){
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || 20);
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);

    if(restaurantData.logoUrl)
        document.getElementById('res-logo').src = restaurantData.logoUrl;

    /* CHEF INTRO FIX */
    if(restaurantData.chefIntro){
        showEl('chef-section', true);
        setUI('chef-intro-text', restaurantData.chefIntro);
    }
}

/* ================= CART ================= */

function saveCart(){
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI(){
    const qty = cart.reduce((s,i)=>s+i.qty,0);
    const total = cart.reduce((s,i)=>s+(i.price*i.qty),0);

    if(cart.length>0){
        showFlex('cart-bar');
        setUI('cart-qty', qty+" Items");
        setUI('cart-total', total);
        if(document.getElementById('cart-badge-count'))
            document.getElementById('cart-badge-count').innerText = qty;
    }else{
        showEl('cart-bar',false);
    }
}

window.openCartModal = ()=>{
    showFlex('cartModal');
    const list = document.getElementById('cart-items-list');
    list.innerHTML="";

    let sub=0;

    cart.forEach((item,index)=>{
        sub+=item.price*item.qty;

        list.innerHTML+=`
        <div class="cart-item">
            <div>
                <b>${item.name}</b><br>
                <small>₹${item.price}</small>
            </div>

            <div class="qty-btn-box">
                <button onclick="changeQty(${index},-1)">-</button>
                <span>${item.qty}</span>
                <button onclick="changeQty(${index},1)">+</button>
            </div>

            <b>₹${item.price*item.qty}</b>
        </div>`;
    });

    updateTotals();
};

window.changeQty = (index,delta)=>{
    cart[index].qty+=delta;
    if(cart[index].qty<=0) cart.splice(index,1);
    saveCart();
    window.openCartModal();
};

/* ================= COUPON SYSTEM ================= */

window.applyCoupon = ()=>{
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);

    if(code==="SAVE50" && sub>=500){
        appliedCoupon = code;
        couponDiscount = 50;
        alert("₹50 Discount Applied!");
    }
    else if(code==="SAVE10"){
        appliedCoupon = code;
        couponDiscount = Math.floor(sub*0.10);
        alert("10% Discount Applied!");
    }
    else{
        alert("Invalid Coupon!");
        appliedCoupon=null;
        couponDiscount=0;
    }

    updateTotals();
};

function updateTotals(){
    const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);

    let final=sub;

    if(couponDiscount>0)
        final-=couponDiscount;

    if(isRedeeming)
        final-=10;

    if(final<0) final=0;

    setUI('summary-subtotal',"₹"+sub);
    setUI('summary-total',"₹"+final);
    setUI('final-amt',final);
}

/* ================= REDEEM FIX ================= */

window.applyRedeem = ()=>{
    if(userPoints>=1000){
        isRedeeming=true;
        alert("₹10 Reward Applied!");
        updateTotals();
    }
};

/* ================= CHECKOUT ================= */

window.openCheckoutModal = ()=>{
    if(cart.length===0) return alert("Cart Empty");
    showFlex('checkoutModal');
    updateTotals();
};

window.setPayMode = (mode)=>{
    selectedPaymentMode=mode;
    document.getElementById('final-place-btn').disabled=false;
};

/* ================= CONFIRM ORDER ================= */

window.confirmOrder = async ()=>{
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name");

    const finalBill = document.getElementById('final-amt').innerText;

    const orderData={
        resId,
        table:tableNo,
        customerName:name,
        userUID,
        items:cart,
        total:finalBill,
        status:"Pending",
        paymentMode:selectedPaymentMode,
        timestamp:new Date()
    };

    await addDoc(collection(db,"orders"),orderData);

    if(userUID){
        let earned=Math.floor(parseInt(finalBill)/10);
        let newPts=userPoints+earned;
        if(isRedeeming) newPts-=1000;

        await setDoc(doc(db,"users",userUID),
            {points:newPts},
            {merge:true}
        );
    }

    localStorage.removeItem(`platto_cart_${resId}`);
    cart=[];
    couponDiscount=0;
    appliedCoupon=null;
    isRedeeming=false;

    alert("Order Placed Successfully!");
    location.reload();
};

window.logout = ()=>signOut(auth).then(()=>location.reload());