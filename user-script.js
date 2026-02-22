import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. GLOBAL VARIABLES & STATE
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`platto_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup"; 
let isRedeeming = false;
let currentAuthMode = "login";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;

// Coupon Global Variables
let couponDiscount = 0;
let appliedCouponCode = "";

const loader = document.getElementById('loader');

// Safety Helper: UI Update
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };

// ==========================================
// 2. INITIALIZATION (APP START)
// ==========================================
async function init() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Invalid QR Code. Scan again.</h3></div>";
        return;
    }

    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        renderCategories();
        handleAnnouncement();
    }

    onAuthStateChanged(auth, async (user) => {
        const navAuthBtn = document.getElementById('nav-auth-btn');
        const navProfileBtn = document.getElementById('nav-profile-btn');

        if (user) {
            userUID = user.uid;
            if(navAuthBtn) navAuthBtn.style.display = "none";
            if(navProfileBtn) navProfileBtn.style.display = "flex";
            
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                    if(document.getElementById('user-profile-name')) document.getElementById('user-profile-name').value = uSnap.data().name || "";
                    if(document.getElementById('user-profile-phone')) document.getElementById('user-profile-phone').value = uSnap.data().phone || "";
                    if(document.getElementById('cust-name-final')) document.getElementById('cust-name-final').value = uSnap.data().name || "";
                }
            });
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            if(navAuthBtn) navAuthBtn.style.display = "flex";
            if(navProfileBtn) navProfileBtn.style.display = "none";
        }
        loadMenu();
    });
    updateCartUI();
}

// ==========================================
// 3. BASKET & QUANTITY Logic (Fixed +/-)
// ==========================================
window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) {
        cart[index].qty++;
    } else {
        cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    }
    saveCart();
    alert(name + " basket mein add ho gaya!");
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    
    // Reset coupon if basket changes
    if(appliedCouponCode) {
        couponDiscount = 0;
        appliedCouponCode = "";
        setUI('coupon-msg', "");
        const coupLine = document.getElementById('coupon-discount-line');
        if(coupLine) coupLine.style.display = "none";
    }
    
    saveCart(); 
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
    setUI('available-pts', userPoints);
    
    let total = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (total < 0 ? 0 : total));
    
    const coupLine = document.getElementById('coupon-discount-line');
    if(coupLine) coupLine.style.display = couponDiscount > 0 ? "flex" : "none";
    setUI('coupon-discount-val', "-₹" + couponDiscount);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));
};

function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if(document.getElementById('cart-badge-count')) document.getElementById('cart-badge-count').innerText = totalQty;
    } else if(bar) showEl('cart-bar', false);
}

// ==========================================
// 4. APPLY COUPON Logic
// ==========================================
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

// ==========================================
// 5. CONFIRM ORDER (Chef Note Fix)
// ==========================================
window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    loader.style.display = "flex";
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), 
        instruction: document.getElementById('chef-note').value || "" 
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);

        // Update Loyalty (₹100 = 10pts)
        const earned = Math.floor(parseInt(finalBill)/10);
        let newPts = userPoints + earned; if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: nameEl.value }, { merge: true });

        localStorage.removeItem(`platto_cart_${resId}`);
        cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    loader.style.display = "none";
};

// ==========================================
// 6. ONLINE PAYMENT & QR FIX
// ==========================================
window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    
    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); 
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amt = document.getElementById('final-amt').innerText;
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
            setUI('final-upi-id', restaurantData.upiId);
        }
    } else showEl('payment-qr-area', false);
    if(document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};

// ==========================================
// 7. OTHERS (Branding, Menu, etc.)
// ==========================================
function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(restaurantData.wifiName) {
        showFlex('wifi-display');
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div><h4>${item.name}</h4><b>₹${item.price}</b></div></div>`;
        });
        showEl('loader', false);
    });
}

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

// UI Modals & Helpers
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const final = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', final < 0 ? 0 : final);
};
window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(sub < 300) { alert("Min ₹300 order for delivery!"); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try { await signInWithEmailAndPassword(auth, e, p); location.reload(); } 
    catch(err) { try { await createUserWithEmailAndPassword(auth, e, p); location.reload(); } catch(err2) { alert(err2.message); } }
};
window.setAuthMode = (m) => {
    currentAuthMode = m;
    document.getElementById('tab-login').classList.toggle('active', m === 'login');
    document.getElementById('tab-signup').classList.toggle('active', m === 'signup');
};
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};
function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}
window.filterMenu = () => loadMenu();

init();