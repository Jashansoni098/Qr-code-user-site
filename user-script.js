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

const loader = document.getElementById('loader');

// Safety Helpers
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };

// ==========================================
// 2. BASKET LOGIC (Defined FIRST to avoid ReferenceError)
// ==========================================
function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
    const cartBar = document.getElementById('cart-bar');
    
    if(cart.length > 0 && cartBar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty);
        setUI('cart-total', totalAmt);
        setUI('cart-badge-count', totalQty);
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
};

window.changeQty = (index, delta) => {
    cart[index].qty += delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    saveCart();
    window.renderCartList();
};

function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

// ==========================================
// 3. INITIALIZATION
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
            showEl('nav-auth-btn', false);
            showEl('nav-profile-btn', true);
            
            // Real-time listener for Points Update
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                }
            });
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            showEl('nav-auth-btn', true);
            showEl('nav-profile-btn', false);
        }
        loadMenu();
    });
    updateCartUI();
}

// ==========================================
// 4. CHECKOUT & PAYMENT FIX
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', isRedeeming ? sub - 10 : sub);
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
    const confirmBtn = document.getElementById('final-place-btn');
    if(confirmBtn) confirmBtn.disabled = false;
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    if(loader) loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    
    try {
        const orderData = {
            resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
            total: finalTotal, status: "Pending", paymentMode: selectedPaymentMode,
            orderType, timestamp: new Date(), note: document.getElementById('chef-note').value || "",
            address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
        };

        await addDoc(collection(db, "orders"), orderData);
        
        // Update Loyalty Points (Earn 10 per 100)
        const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        let updatedPoints = userPoints + earned;
        if(isRedeeming) updatedPoints -= 1000;
        await setDoc(userRef, { points: updatedPoints, name: nameEl.value }, { merge: true });

        // Show success screen
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);
        
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        updateCartUI();
    } catch(e) { alert(e.message); }
    loader.style.display = "none";
};

// ==========================================
// 5. TRACKING & HISTORY FIX
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    if(!list) return;
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        list.innerHTML = "";
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
    if(!list) return;
    list.innerHTML = "Loading history...";
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

// ==========================================
// 6. OTHER FEATURES & HELPERS
// ==========================================
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    setUI('available-pts', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if(!list) return;
    list.innerHTML = cart.length === 0 ? "<p>Basket is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price * item.qty;
        list.innerHTML += `
        <div class="cart-item">
            <div style="text-align:left;"><b>${item.name}</b><br><small>₹${item.price}</small></div>
            <div class="qty-controls">
                <button class="qty-btn" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <b>₹${item.price * item.qty}</b>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('summary-total', "₹" + (isRedeeming ? sub - 10 : sub));
};

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories && list) {
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

window.filterMenu = () => loadMenu();

window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.closeModal = (id) => showEl(id, false);
window.redeemPoints = () => { isRedeeming = true; alert("Discount Applied!"); window.openCartModal(); };

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div><h4>${item.name}</h4><b>₹${item.price}</b></div></div>`;
        });
        if(loader) loader.style.display = "none";
    });
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}

init();