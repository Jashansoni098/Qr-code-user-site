import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. HELPERS & SAFETY CHECKS (FIXED ERRORS)
// ==========================================
const setUI = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if (el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if (el) el.style.display = show ? "flex" : "none"; };

// ==========================================
// 2. GLOBAL VARIABLES & STATE
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
let couponDiscount = 0;
let appliedCouponCode = "";

const loader = document.getElementById('loader');

// ==========================================
// 3. BASKET & QUANTITY LOGIC
// ==========================================
function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
    const cartBar = document.getElementById('cart-bar');
    
    if(cart.length > 0 && cartBar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        const badge = document.getElementById('cart-badge-count');
        if(badge) badge.innerText = totalQty;
    } else if(cartBar) {
        showEl('cart-bar', false);
    }
}

window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) {
        cart[index].qty++;
    } else {
        cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    }
    saveCart();
    alert(name + " added!");
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    
    if (appliedCouponCode) {
        couponDiscount = 0;
        appliedCouponCode = "";
        setUI('coupon-msg', "");
        showEl('coupon-discount-line', false);
    }
    
    saveCart();
    window.renderCartList();
};

function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = cart.length === 0 ? "<div style='padding:40px; color:gray;'>Empty Basket</div>" : "";
    
    let subtotal = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        subtotal += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-info-box"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-wrapper">
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-number">${item.qty}</span>
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div class="item-total-price">₹${itemTotal}</div>
        </div>`;
    });

    setUI('summary-subtotal', "₹" + subtotal);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));

    let finalTotal = subtotal;
    if (isRedeeming) finalTotal -= 10;
    finalTotal -= couponDiscount;

    setUI('summary-total', "₹" + (finalTotal < 0 ? 0 : finalTotal));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

// ==========================================
// 4. INITIALIZATION & SYNC
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
        if (user) {
            userUID = user.uid;
            showEl('nav-auth-btn', false);
            showEl('nav-profile-btn');
            
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
            showEl('nav-auth-btn');
            showEl('nav-profile-btn', false);
        }
        loadMenu();
    });
    updateCartUI();
}

// ==========================================
// 5. COUPON & PAYMENT & ORDER
// ==========================================
window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if (!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);

    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const cData = snap.docs[0].data();
            if (subtotal < cData.minOrder) return alert(`Min order ₹${cData.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * cData.percent) / 100), cData.maxDiscount);
            appliedCouponCode = code;
            alert(`🎉 ₹${couponDiscount} discount applied!`);
            window.renderCartList();
        } else alert("Invalid Coupon!");
    } catch (e) { alert("Error applying coupon."); }
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const btnO = document.getElementById('mode-online');
    const btnC = document.getElementById('mode-cash');
    if(btnO) btnO.classList.toggle('selected', mode === 'Online');
    if(btnC) btnC.classList.toggle('selected', mode === 'Cash');

    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online') {
        showEl('payment-qr-area', true);
        const qrDiv = document.getElementById('checkout-payment-qr'); 
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amt = document.getElementById('final-amt').innerText;
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
            setUI('final-upi-id', restaurantData.upiId);
        }
    } else { 
        showEl('payment-qr-area', false); 
    }
    if(document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        const earned = Math.floor(parseInt(finalBill) / 10);
        const userRef = doc(db, "users", userUID);
        let updatedPoints = userPoints + earned;
        if(isRedeeming) updatedPoints -= 1000;
        await setDoc(userRef, { points: updatedPoints, name: nameEl.value }, { merge: true });

        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 6. UI HELPERS & MODALS
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if(!list) return; list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if(!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item"><b>Status: ${o.status}</b><br>Table ${o.table} | ₹${o.total}</div>`;
            }
        });
        if(!hasLive) list.innerHTML = "<p>No active orders.</p>";
    });
};

window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if(!list) return; list.innerHTML = "Loading history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Done") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString() : "--";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total}</div>`;
        }
    });
};

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

window.setAuthMode = (m) => {
    currentAuthMode = m;
    document.getElementById('tab-login').classList.toggle('active', m === 'login');
    document.getElementById('tab-signup').classList.toggle('active', m === 'signup');
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    setUI('available-pts', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
}

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div class="food-info"><h4>${item.name}</h4><b>₹${item.price}</b></div></div>`;
        });
        showEl('loader', false);
    });
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

// Fixed UI Mappings
window.closeModal = (id) => showEl(id, false);
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.openCheckoutModal = () => { if(cart.length === 0) return alert("Basket empty!"); window.closeModal('cartModal'); showFlex('checkoutModal'); const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0); setUI('final-amt', isRedeeming ? sub - 10 : sub); };
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.filterMenu = () => loadMenu();

init();