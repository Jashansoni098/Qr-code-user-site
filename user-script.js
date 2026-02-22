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

// Global Coupon Variables (Start mein add karein)
let couponDiscount = 0;
let appliedCouponCode = "";

// --- 1. Basket Quantity Fix (+/-) ---
window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    
    // Reset coupon if basket changes
    if(appliedCouponCode) {
        couponDiscount = 0;
        appliedCouponCode = "";
        setUI('coupon-msg', "");
    }
    
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.renderCartList();
};

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if(!list) return;
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px; color:gray;'>Your basket is empty</p>" : "";
    let sub = 0;
    
    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        sub += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty || 1}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${itemTotal}</div>
        </div>`;
    });

    setUI('summary-subtotal', "₹" + sub);
    
    let total = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (total < 0 ? 0 : total));
    
    const coupLine = document.getElementById('coupon-discount-line');
    if(coupLine) coupLine.style.display = couponDiscount > 0 ? "flex" : "none";
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

// --- 2. APPLY COUPON Logic ---
window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if(!code) return alert("Please enter code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);

    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const c = snap.docs[0].data();
            if(subtotal < c.minOrder) return alert(`Minimum order ₹${c.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Coupon Applied: ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon Code");
    } catch(e) { alert("Coupon Error"); }
};

// --- 3. Confirm Order (Chef Note ID Fix) ---
window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    loader.style.display = "flex";
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), 
        instruction: document.getElementById('chef-note').value || "" // FIX: Match with HTML ID
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        document.getElementById('checkoutModal').style.display = "none";
        document.getElementById('success-screen').style.display = "flex";
        setUI('s-name', nameEl.value);
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    loader.style.display = "none";
};
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