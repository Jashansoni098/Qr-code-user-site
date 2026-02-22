import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global Variables
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

// Helper to safely set UI
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };

// ==========================================
// 1. INITIALIZATION
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
            
            const userSnap = await getDoc(doc(db, "users", userUID));
            if (userSnap.exists()) {
                const data = userSnap.data();
                userPoints = data.points || 0;
                if(document.getElementById('user-profile-name')) document.getElementById('user-profile-name').value = data.name || "";
                if(document.getElementById('user-profile-phone')) document.getElementById('user-profile-phone').value = data.phone || "";
                if(document.getElementById('cust-name-final')) document.getElementById('cust-name-final').value = data.name || "";
            }
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            if(navAuthBtn) navAuthBtn.style.display = "flex";
            if(navProfileBtn) navProfileBtn.style.display = "none";
        }
        updatePointsUI();
        loadMenu();
    });
    updateCartUI();
}

// ==========================================
// 2. BASKET & QUANTITY (+/-)
// ==========================================
window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) cart[index].qty++;
    else cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    saveCart();
    alert(name + " added!");
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

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    if(document.getElementById('cart-bar')) document.getElementById('cart-bar').style.display = cart.length > 0 ? "flex" : "none";
    setUI('cart-qty', totalQty);
    setUI('cart-total', totalAmt);
    setUI('cart-badge-count', totalQty);
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
            <div class="qty-btn-box">
                <button onclick="window.changeQty(${index}, -1)">-</button>
                <span>${item.qty}</span>
                <button onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <b>₹${item.price * item.qty}</b>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    const totalFinal = isRedeeming ? sub - 10 : sub;
    setUI('summary-total', "₹" + (totalFinal < 0 ? 0 : totalFinal));
    showFlex('discount-line', isRedeeming);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));
};

// ==========================================
// 3. TRACKING & HISTORY (Separate)
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if(!list) return;
        list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if(!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item" style="border-left:4px solid var(--primary);">
                    <span style="float:right; color:var(--primary); font-weight:800;">${o.status}</span>
                    <b>Table ${o.table}</b><br><small>Bill: ₹${o.total}</small>
                </div>`;
            }
        });
        if(!hasLive) list.innerHTML = "<p style='padding:20px;'>No active orders.</p>";
    });
};

window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if(!list) return;
    list.innerHTML = "Fetching...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Done") {
            const date = o.timestamp.toDate().toLocaleDateString('en-GB');
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

// ==========================================
// 4. CHECKOUT & PAYMENT Logic
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
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online' && qrArea) {
        qrArea.style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else if(qrArea) qrArea.style.display = "none";
    document.getElementById('final-place-btn').disabled = false;
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalTotal, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address').value || ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        showEl('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);
        localStorage.removeItem(`platto_cart_${resId}`);
        const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
        let newPts = userPoints + earned; if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: nameEl.value }, { merge: true });
        cart = [];
    } catch(e) { alert(e.message); }
    loader.style.display = "none";
};

// ==========================================
// 5. CUSTOMIZATION (S/M/L)
// ==========================================
window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    document.getElementById('cust-item-name').innerText = item.name;
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', "₹" + (parseInt(item.price) + 100));
    const exDiv = document.getElementById('extras-options');
    exDiv.innerHTML = "";
    if(restaurantData.variants) {
        restaurantData.variants.forEach(v => {
            exDiv.innerHTML += `<label class="option-row"><span><input type="checkbox" class="ex-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span><b>+₹${v.price}</b></label>`;
        });
    }
    showFlex('customizeModal');
};

window.addCustomizedToCart = () => {
    const size = document.querySelector('input[name="p-size"]:checked').value;
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    saveCart(); window.closeModal('customizeModal');
};

// ==========================================
// 6. UTILS
// ==========================================
window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(sub < 300) { alert("Min ₹300 for delivery!"); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div class="food-info"><h4>${item.name}</h4><b class="food-price">₹${item.price}</b></div></div>`;
        });
        showEl('loader', false);
    });
}

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    const wifiBox = document.getElementById('wifi-display');
    if(restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        setUI('wifi-name', restaurantData.wifiName); setUI('wifi-pass', restaurantData.wifiPass);
    }
    if(document.getElementById('link-fb')) document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    if(document.getElementById('link-ig')) document.getElementById('link-ig').href = restaurantData.igLink || "#";
    if(document.getElementById('link-yt')) document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    if(document.getElementById('whatsapp-btn')) document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories && list) {
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};
window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if(currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        window.closeModal('authModal');
    } catch(err) { alert(err.message); }
};
window.saveUserProfile = async () => {
    const name = document.getElementById('user-profile-name').value;
    const phone = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name, phone }, { merge: true });
    alert("Profile Saved!"); window.closeModal('profileModal');
};
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => currentAuthMode = m;
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };

init();