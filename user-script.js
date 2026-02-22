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

// Helper to safely set UI text & visibility
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

    // Fetch Restaurant Main Settings
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        renderCategories();
        handleAnnouncement();
    }

    // Auth & Loyalty Sync
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
                // Pre-fill profile & checkout fields
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
// 3. BRANDING, SOCIALS & WIFI
// ==========================================
function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    const wifiBox = document.getElementById('wifi-display');
    if(restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
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

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

// ==========================================
// 4. MENU & CUSTOMIZATION (S/M/L & EXTRAS)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return;
        grid.innerHTML = "";
        
        const searchInput = document.getElementById('menu-search');
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(search && !item.name.toLowerCase().includes(search)) return;

            grid.innerHTML += `
                <div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}</b>
                    </div>
                </div>`;
        });
        if(loader) loader.style.display = "none";
    });
}

window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    document.getElementById('cust-item-name').innerText = item.name;
    
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', "₹" + (parseInt(item.price) + 100));

    const extrasDiv = document.getElementById('extras-options');
    if(extrasDiv) {
        extrasDiv.innerHTML = "";
        if(restaurantData.variants) {
            restaurantData.variants.forEach(v => {
                extrasDiv.innerHTML += `
                    <label class="option-row">
                        <span><input type="checkbox" class="ex-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span>
                        <b>+₹${v.price}</b>
                    </label>`;
            });
        }
    }
    document.getElementById('customizeModal').style.display = "flex";
};

window.addCustomizedToCart = () => {
    const sizeInput = document.querySelector('input[name="p-size"]:checked');
    const size = sizeInput ? sizeInput.value : "Regular";
    
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    
    let selectedExtras = [];
    document.querySelectorAll('.ex-item:checked').forEach(el => {
        price += parseInt(el.dataset.price);
        selectedExtras.push(el.value);
    });

    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, extras: selectedExtras, qty: 1 });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.closeModal('customizeModal');
};

// ==========================================
// 5. BASKET LOGIC (Quantity +/- & Redeem)
// ==========================================
function updateCartUI() {
    const totalAmt = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
    const cartBar = document.getElementById('cart-bar');
    if(cart.length > 0 && cartBar) {
        cartBar.style.display = "flex";
        setUI('cart-qty', cart.length + " Items");
        setUI('cart-total', totalAmt);
        const badge = document.getElementById('cart-badge-count');
        if(badge) badge.innerText = cart.length;
    } else if(cartBar) {
        cartBar.style.display = "none";
    }
}

window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    const list = document.getElementById('cart-items-list');
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px;'>Basket is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        sub += itemTotal;
        list.innerHTML += `
        <div class="cart-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
            <div style="text-align:left;"><b>${item.name}</b><br><small>₹${item.price}</small></div>
            <div style="display:flex; align-items:center; gap:10px;">
                <button onclick="window.changeQty(${index}, -1)" style="border:none; background:#eee; padding:5px 10px; border-radius:5px;">-</button>
                <b>${item.qty || 1}</b>
                <button onclick="window.changeQty(${index}, 1)" style="border:none; background:#eee; padding:5px 10px; border-radius:5px;">+</button>
            </div>
            <b>₹${itemTotal}</b>
        </div>`;
    });
    
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    
    const redeemSec = document.getElementById('redeem-section');
    if(redeemSec) redeemSec.style.display = (userPoints >= 1000 && cart.length > 0) ? "block" : "none";

    const totalFinal = isRedeeming ? sub - 10 : sub;
    setUI('summary-total', "₹" + (totalFinal < 0 ? 0 : totalFinal));
    showFlex('discount-line', isRedeeming);
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.openCartModal();
};

// ==========================================
// 6. DELIVERY & CHECKOUT
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showEl('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', isRedeeming ? sub - 10 : sub);
};

window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const btnP = document.getElementById('type-pickup');
    const btnD = document.getElementById('type-delivery');
    if(btnP) btnP.classList.toggle('active', type === 'Pickup');
    if(btnD) btnD.classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        if(sub < 300) { alert("Min order ₹300 for delivery!"); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else { showEl('delivery-address-box', false); }
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const btnO = document.getElementById('mode-online');
    const btnC = document.getElementById('mode-cash');
    if(btnO) btnO.classList.toggle('selected', mode === 'Online');
    if(btnC) btnC.classList.toggle('selected', mode === 'Cash');

    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else { showEl('payment-qr-area', false); }
    const confirmBtn = document.getElementById('final-place-btn');
    if(confirmBtn) confirmBtn.disabled = false;
};

// ==========================================
// 7. CONFIRM ORDER & LOYALTY
// ==========================================
window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    const name = nameInput ? nameInput.value.trim() : "";
    if(!name) return alert("Enter Name!");
    
    loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalTotal, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        // Success View
        window.closeModal('checkoutModal');
        showEl('success-screen');
        setUI('s-name', name);
        setUI('s-table', tableNo);

        // Loyalty Update
        const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const snap = await getDoc(userRef);
        let pts = snap.exists() ? snap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned, name: name }, { merge: true });

        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        updateCartUI();
    } catch(e) { alert(e.message); }
    loader.style.display = "none";
};

// ==========================================
// 8. TRACKING, PROFILE & AUTH
// ==========================================
window.openHistoryModal = async () => {
    const list = document.getElementById('order-history-list');
    if(!list) return;
    list.innerHTML = "Fetching history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p style='padding:20px;'>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
        list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
    });
    showEl('trackingModal');
};

function checkLiveOrders() {
    if(!userUID) return;
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => { /* Live track logic for history shared */ });
}

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
    alert("Profile Saved!");
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

window.redeemPoints = () => { isRedeeming = true; alert("Discount Applied!"); window.openCartModal(); };
window.setAuthMode = (m) => {
    currentAuthMode = m;
    const tLog = document.getElementById('tab-login');
    const tSign = document.getElementById('tab-signup');
    if(tLog) tLog.classList.toggle('active', m === 'login');
    if(tSign) tSign.classList.toggle('active', m === 'signup');
};

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showEl('authModal');
window.openProfileModal = () => showEl('profileModal');
window.openTracking = () => window.openHistoryModal();
window.logout = () => signOut(auth).then(() => location.reload());

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showEl('announcement-modal');
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}

window.filterMenu = () => loadMenu();

init();