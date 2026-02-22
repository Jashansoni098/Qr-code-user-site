import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
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
let couponDiscount = 0;
let appliedCouponCode = "";

const loader = document.getElementById('loader');

// Safety Helpers
const setUI = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if (el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if (el) el.style.display = show ? "flex" : "none"; };

/* ================= INITIALIZATION ================= */
async function init() {
    if (!resId) {
        document.body.innerHTML = "<h2 style='text-align:center;padding:100px;'>Invalid QR</h2>";
        return;
    }

    try {
        const snap = await getDoc(doc(db, "restaurants", resId));
        if (snap.exists()) {
            restaurantData = snap.data();
            renderBranding();
        }

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userUID = user.uid;
                onSnapshot(doc(db, "users", userUID), (u) => {
                    if (u.exists()) {
                        userPoints = u.data().points || 0;
                        updatePointsUI();
                    }
                });
            } else {
                userUID = localStorage.getItem('guest_id') || "g_" + Date.now();
                localStorage.setItem('guest_id', userUID);
            }
            loadMenu(); // Menu load hone par hi loader hatega
        });

        updateCartUI();
    } catch (err) {
        console.error("Init Error:", err);
        if(loader) loader.style.display = "none";
    }
}

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || 20);
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if (restaurantData.logoUrl && document.getElementById('res-logo'))
        document.getElementById('res-logo').src = restaurantData.logoUrl;
}

/* ================= MENU LOADING ================= */
function loadMenu() {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if (!grid) return;
        grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            grid.innerHTML += `
                <div class="food-card">
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}</b>
                    </div>
                    <button class="add-btn" onclick="window.addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        if (loader) loader.style.display = "none"; // Loader hidden here
    });
}

/* ================= CART LOGIC ================= */
window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if (index > -1) {
        cart[index].qty++;
    } else {
        cart.push({ name, price: parseInt(price), qty: 1 });
    }
    saveCart();
};

window.changeQty = (index, delta) => {
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    if (appliedCouponCode) { couponDiscount = 0; appliedCouponCode = ""; setUI('coupon-msg', ""); }
    saveCart();
    window.renderCartList();
};

function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const bar = document.getElementById('cart-bar');
    if (cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if (document.getElementById('cart-badge-count')) 
            document.getElementById('cart-badge-count').innerText = totalQty;
    } else if (bar) showEl('cart-bar', false);
}

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px; color:gray;'>Your basket is empty</p>" : "";
    
    let subtotal = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        subtotal += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${itemTotal}</div>
        </div>`;
    });

    setUI('summary-subtotal', "₹" + subtotal);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));

    let final = subtotal - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (final < 0 ? 0 : final));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

/* ================= COUPONS & REDEEM ================= */
window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if (!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);

    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const c = snap.docs[0].data();
            if (subtotal < c.minOrder) return alert(`Minimum order ₹${c.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Coupon Applied: ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon Code");
    } catch (e) { alert("Coupon Error"); }
};

window.redeemPoints = () => {
    if (userPoints < 1000) return;
    isRedeeming = true;
    alert("₹10 Discount Applied!");
    window.renderCartList();
};

/* ================= CHECKOUT & ORDER ================= */
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };

window.openCheckoutModal = () => {
    if (cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    let final = subtotal - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', final < 0 ? 0 : final);
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');

    if (mode === 'Online') {
        showEl('payment-qr-area', true);
        const qrDiv = document.getElementById('checkout-payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else {
        showEl('payment-qr-area', false);
    }
    document.getElementById('final-place-btn').disabled = false;
};

window.setOrderType = (type) => {
    orderType = type;
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if (type === 'Delivery') {
        const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
        if (sub < 300) { alert("Min ₹300 order for delivery!"); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if (!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), 
        instruction: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        if (userUID && !userUID.startsWith('g_')) {
            const earned = Math.floor(parseInt(finalBill) / 10);
            let newPts = userPoints + earned;
            if (isRedeeming) newPts -= 1000;
            await setDoc(doc(db, "users", userUID), { points: newPts }, { merge: true });
        }

        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
    } catch (e) { alert("Order Failed: " + e.message); }
    showEl('loader', false);
};

/* ================= TRACKING & HISTORY ================= */
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if (!list) return;
        list.innerHTML = "";
        let hasActive = false;
        snap.forEach(d => {
            const o = d.data();
            if (!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                hasActive = true;
                list.innerHTML += `<div class="history-item" style="border-left:5px solid var(--primary); padding:10px; margin-bottom:10px; background:#fff;">
                    <span style="float:right; font-weight:800; color:var(--primary);">${o.status}</span>
                    <b>Table ${o.table}</b><br><small>Total Bill: ₹${o.total}</small>
                </div>`;
            }
        });
        if (!hasActive) list.innerHTML = "<p>No active orders.</p>";
    });
};

window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if (!list) return;
    list.innerHTML = "Loading...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if (o.status === "Picked Up" || o.status === "Done") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "--";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total}</div>`;
        }
    });
};

/* ================= HELPERS ================= */
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if (redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());

window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if (currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        location.reload();
    } catch (err) { alert(err.message); }
};

window.saveUserProfile = async () => {
    const n = document.getElementById('user-profile-name').value;
    const ph = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name: n, phone: ph }, { merge: true });
    alert("Profile Saved!"); window.closeModal('profileModal');
};

init();