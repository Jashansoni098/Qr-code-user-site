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
let orderType = "Pickup"; // Default
let isRedeeming = false;
let authMode = "login";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;

const loader = document.getElementById('loader');

// ==========================================
// 1. INITIALIZATION & DATA FETCH
// ==========================================
async function init() {
    if (!resId) {
        document.body.innerHTML = "<h3 style='text-align:center; padding:100px;'>⚠️ Invalid QR Code.</h3>";
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
                // Auto-fill profile & checkout fields
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
// 2. BRANDING & CATEGORIES
// ==========================================
function renderBranding() {
    document.getElementById('res-name-display').innerText = restaurantData.name;
    document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    document.getElementById('res-about-text').innerText = restaurantData.about || "";
    document.getElementById('tbl-no').innerText = tableNo;
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    // WiFi
    if(restaurantData.wifiName) {
        document.getElementById('wifi-display').style.display = "flex";
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    // Socials
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories) {
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
// 3. MENU & CUSTOMIZATION (SIZE & EXTRAS)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        grid.innerHTML = "";
        const isVeg = document.getElementById('veg-toggle').checked;
        const search = document.getElementById('menu-search').value.toLowerCase();

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(isVeg && !item.name.toLowerCase().includes('veg')) return;
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
    
    // Set Size Prices (Default + Logic)
    document.getElementById('p-price-s').innerText = "₹" + item.price;
    document.getElementById('p-price-m').innerText = "₹" + (parseInt(item.price) + 50);
    document.getElementById('p-price-l').innerText = "₹" + (parseInt(item.price) + 100);

    // Load Extras from Owner Variants
    const extrasDiv = document.getElementById('extras-options');
    extrasDiv.innerHTML = "";
    if(restaurantData.variants) {
        restaurantData.variants.forEach(v => {
            extrasDiv.innerHTML += `
                <label class="choice-row">
                    <span><input type="checkbox" class="extra-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span>
                    <b>+₹${v.price}</b>
                </label>`;
        });
    }
    document.getElementById('customizeModal').style.display = "flex";
};

window.addCustomizedToCart = () => {
    const size = document.querySelector('input[name="p-size"]:checked').value;
    let finalPrice = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') finalPrice += 50;
    if(size === 'Large') finalPrice += 100;

    let extras = [];
    document.querySelectorAll('.extra-item:checked').forEach(el => {
        finalPrice += parseInt(el.dataset.price);
        extras.push(el.value);
    });

    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price: finalPrice, extras: extras });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    window.closeModal('customizeModal');
};

// ==========================================
// 4. CART & CHECKOUT LOGIC
// ==========================================
function updateCartUI() {
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const cartBar = document.getElementById('cart-bar');
    if(cart.length > 0) {
        if(cartBar) cartBar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
        document.getElementById('cart-badge-count').innerText = cart.length;
    } else {
        if(cartBar) cartBar.style.display = "none";
        document.getElementById('cart-badge-count').innerText = "0";
    }
}

window.openCartModal = () => {
    const modal = document.getElementById('cartModal');
    modal.style.display = "flex";
    const list = document.getElementById('cart-items-list');
    list.innerHTML = cart.length === 0 ? "<p>Basket is empty</p>" : "";
    let subtotal = 0;
    cart.forEach((item, index) => {
        subtotal += item.price;
        list.innerHTML += `<div class="cart-item"><span>${item.name}</span><b>₹${item.price}</b> <button onclick="window.removeItem(${index})">❌</button></div>`;
    });
    document.getElementById('summary-subtotal').innerText = "₹" + subtotal;
    document.getElementById('summary-total').innerText = "₹" + (isRedeeming ? subtotal - 10 : subtotal);
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    window.openCartModal();
};

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Cart is empty!");
    window.closeModal('cartModal');
    document.getElementById('checkoutModal').style.display = "flex";
    const subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    document.getElementById('final-amt').innerText = isRedeeming ? subtotal - 10 : subtotal;
};

// Delivery Logic: ₹300 Min & 3KM Range
window.setOrderType = (type) => {
    orderType = type;
    const subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        if(subtotal < 300) {
            alert("Min. order ₹300 zaroori hai delivery ke liye!");
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
        const qrDiv = document.getElementById('checkout-payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        document.getElementById('final-upi-id').innerText = restaurantData.upiId;
    } else { document.getElementById('payment-qr-area').style.display = "none"; }
    document.getElementById('final-place-btn').disabled = false;
};

// ==========================================
// 5. ORDER CONFIRMATION & HISTORY
// ==========================================
window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name!");
    loader.style.display = "flex";
    
    const finalTotal = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID,
        items: cart, total: finalTotal, status: "Pending",
        paymentMode: selectedPaymentMode, orderType: orderType,
        address: document.getElementById('cust-address').value || "At Table",
        timestamp: new Date(), note: document.getElementById('chef-note').value
    };

    await addDoc(collection(db, "orders"), orderData);

    // Loyalty Calc: ₹100 = 10 pts
    const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
    const userRef = doc(db, "users", userUID);
    const snap = await getDoc(userRef);
    let pts = snap.exists() ? snap.data().points : 0;
    if(isRedeeming) pts -= 1000;
    await setDoc(userRef, { points: pts + earned }, { merge: true });

    localStorage.removeItem(`platto_cart_${resId}`);
    cart = [];
    document.getElementById('checkoutModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    document.getElementById('s-table').innerText = tableNo;
    loader.style.display = "none";
};

window.openHistoryModal = async () => {
    const list = document.getElementById('order-history-list');
    list.innerHTML = "Fetching history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        const date = o.timestamp.toDate().toLocaleDateString('en-GB');
        list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
    });
    document.getElementById('trackingModal').style.display = "flex";
};

// ==========================================
// 6. UTILS & AUTH
// ==========================================
window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    try {
        if(authMode === 'login') await signInWithEmailAndPassword(auth, email, pass);
        else await createUserWithEmailAndPassword(auth, email, pass);
        window.closeModal('authModal');
    } catch(e) { alert(e.message); }
};

window.saveUserProfile = async () => {
    const name = document.getElementById('user-profile-name').value;
    const phone = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name, phone }, { merge: true });
    alert("Profile Saved!");
};

window.closeModal = (id) => document.getElementById(id).style.display = "none";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.logout = () => signOut(auth).then(() => location.reload());

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        document.getElementById('ann-title').innerText = restaurantData.annTitle;
        document.getElementById('ann-desc').innerText = restaurantData.annText;
    }
}

function updatePointsUI() {
    document.getElementById('user-pts').innerText = userPoints;
    document.getElementById('redeem-btn').disabled = userPoints < 1000;
}

window.redeemPoints = () => { isRedeeming = true; alert("Discount Applied!"); window.openCartModal(); };

function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => {
        // Shared with history modal logic
    });
}

init();