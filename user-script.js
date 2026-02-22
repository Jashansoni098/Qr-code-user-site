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

// Helper to safely set UI text
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };

// ==========================================
// 2. INITIALIZATION (APP START)
// ==========================================
async function init() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Invalid QR Code. Scan again.</h3></div>";
        return;
    }

    // Fetch Restaurant Main Data
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
                // Pre-fill profile fields
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
        checkLiveOrders(); 
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
    
    // WiFi Display
    const wifiBox = document.getElementById('wifi-display');
    if(restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    
    // Social Links
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
    
    // Set Size Prices (S=Base, M=+50, L=+100)
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', "₹" + (parseInt(item.price) + 100));

    // Load Extras from Owner Variants
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

    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, extras: selectedExtras });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.closeModal('customizeModal');
};

// ==========================================
// 5. CART & CHECKOUT LOGIC
// ==========================================
function updateCartUI() {
    const totalAmt = cart.reduce((s, i) => s + i.price, 0);
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
        sub += item.price;
        list.innerHTML += `<div class="cart-item" style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; text-align:left;">
            <div><b>${item.name}</b><br><small>${item.extras ? item.extras.join(', ') : ''}</small></div>
            <div><b>₹${item.price}</b> <button onclick="window.removeItem(${index})" style="background:none; border:none; margin-left:10px;">❌</button></div>
        </div>`;
    });
    
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    
    const redeemSec = document.getElementById('redeem-section');
    if(redeemSec) redeemSec.style.display = (userPoints >= 1000 && cart.length > 0) ? "block" : "none";

    const totalFinal = isRedeeming ? sub - 10 : sub;
    setUI('summary-total', "₹" + (totalFinal < 0 ? 0 : totalFinal));
    const discLine = document.getElementById('discount-line');
    if(discLine) discLine.style.display = isRedeeming ? "flex" : "none";
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.openCartModal();
};

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket is empty!");
    window.closeModal('cartModal');
    document.getElementById('checkoutModal').style.display = "flex";
    const sub = cart.reduce((s, i) => s + i.price, 0);
    setUI('final-amt', isRedeeming ? sub - 10 : sub);
};

window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        if(sub < 300) {
            alert("Min. order ₹300 required for delivery!");
            window.setOrderType('Pickup');
            return;
        }
        document.getElementById('delivery-address-box').style.display = "block";
    } else {
        document.getElementById('delivery-address-box').style.display = "none";
    }
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        document.getElementById('payment-qr-area').style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else { document.getElementById('payment-qr-area').style.display = "none"; }
    document.getElementById('final-place-btn').disabled = false;
};

// ==========================================
// 6. CONFIRM ORDER & SUCCESS
// ==========================================
window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    const name = nameEl ? nameEl.value.trim() : "";
    if(!name) return alert("Enter Name!");
    
    if(loader) loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalTotal, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address').value || "At Table"
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        // Success View
        document.getElementById('checkoutModal').style.display = "none";
        document.getElementById('success-screen').style.display = "flex";
        setUI('s-name', name);
        setUI('s-table', tableNo);

        // Update Loyalty
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
    if(loader) loader.style.display = "none";
};

// ==========================================
// 7. TRACKING, HISTORY & AUTH
// ==========================================
window.openHistoryModal = async () => {
    const list = document.getElementById('order-history-list');
    if(!list) return;
    list.innerHTML = "Fetching history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p style='padding:20px;'>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
        list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
    });
    document.getElementById('trackingModal').style.display = "flex";
};

function checkLiveOrders() {
    if(!userUID) return;
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => { /* Orders track logic for history shared */ });
}

window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    if(!e || !p) return alert("Enter credentials");
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

// ==========================================
// 8. HELPERS & UTILS
// ==========================================
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

window.redeemPoints = () => { isRedeeming = true; alert("Loyalty Applied!"); window.openCartModal(); };
window.setAuthMode = (m) => {
    currentAuthMode = m;
    document.getElementById('tab-login').classList.toggle('active', m === 'login');
    document.getElementById('tab-signup').classList.toggle('active', m === 'signup');
};
window.closeModal = (id) => { const m = document.getElementById(id); if(m) m.style.display = "none"; };
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.openTracking = () => window.openHistoryModal();
window.logout = () => signOut(auth).then(() => location.reload());

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}

window.filterMenu = () => loadMenu();

init();