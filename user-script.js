import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`platto_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup";
let isRedeeming = false;
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;
let currentAuthMode = "login";

const loader = document.getElementById('loader');

// ==========================================
// 1. INITIALIZATION
// ==========================================
async function init() {
    if (!resId) return;
    
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
        updatePointsUI(); // Error fix function
        loadMenu();
        checkLiveOrders();
    });
    updateCartUI();
}

// FIX: TypeError of Null Logic
function updatePointsUI() {
    const ptsEl = document.getElementById('user-pts');
    const redeemBtn = document.getElementById('redeem-btn'); 

    if(ptsEl) ptsEl.innerText = userPoints;
    
    // Safety Check: Pehle check karein ki button exist karta hai ya nahi
    if(redeemBtn) {
        redeemBtn.disabled = (userPoints < 1000);
    }
}

// ==========================================
// 2. BRANDING, SOCIALS & WIFI
// ==========================================
function renderBranding() {
    document.getElementById('res-name-display').innerText = restaurantData.name;
    document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    document.getElementById('res-about-text').innerText = restaurantData.about || "";
    document.getElementById('tbl-no').innerText = tableNo;
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    if(restaurantData.wifiName) {
        document.getElementById('wifi-display').style.display = "flex";
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories && list) {
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

// ==========================================
// 3. MENU & CUSTOMIZATION (S/M/L)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return;
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
    document.getElementById('p-price-s').innerText = "₹" + item.price;
    document.getElementById('p-price-m').innerText = "₹" + (parseInt(item.price) + 50);
    document.getElementById('p-price-l').innerText = "₹" + (parseInt(item.price) + 100);

    const extrasDiv = document.getElementById('extras-options');
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
    document.getElementById('customizeModal').style.display = "flex";
};

window.addCustomizedToCart = () => {
    const size = document.querySelector('input[name="p-size"]:checked').value;
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    
    cart.push({ name: `${currentItemToCustomize.name} (${size})`, price });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.closeModal('customizeModal');
};

// ==========================================
// 4. CART & CHECKOUT LOGIC
// ==========================================
function updateCartUI() {
    const total = cart.reduce((s, i) => s + i.price, 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0) {
        if(bar) bar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
        document.getElementById('cart-badge-count').innerText = cart.length;
    } else {
        if(bar) bar.style.display = "none";
        document.getElementById('cart-badge-count').innerText = "0";
    }
}

window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    const list = document.getElementById('cart-items-list');
    list.innerHTML = cart.length === 0 ? "<p>Cart is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price;
        list.innerHTML += `<div class="cart-item"><span>${item.name}</span><b>₹${item.price}</b><button onclick="window.removeItem(${index})">❌</button></div>`;
    });
    document.getElementById('summary-subtotal').innerText = "₹" + sub;
    document.getElementById('summary-total').innerText = "₹" + (isRedeeming ? sub - 10 : sub);
    document.getElementById('loyalty-redeem-line').style.display = isRedeeming ? "flex" : "none";
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); window.openCartModal();
};

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Add items first!");
    window.closeModal('cartModal');
    document.getElementById('checkoutModal').style.display = "flex";
    const sub = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('final-amt').innerText = isRedeeming ? sub - 10 : sub;
};

// Delivery Logic
window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(sub < 300) { alert("Min ₹300 for delivery!"); window.setOrderType('Pickup'); return; }
        document.getElementById('delivery-address-box').style.display = "block";
    } else document.getElementById('delivery-address-box').style.display = "none";
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        document.getElementById('payment-qr-area').style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${document.getElementById('final-amt').innerText}`, width: 140, height: 140 });
    } else document.getElementById('payment-qr-area').style.display = "none";
    document.getElementById('final-place-btn').disabled = false;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name");
    loader.style.display = "flex";
    const finalBill = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value
    };
    await addDoc(collection(db, "orders"), orderData);
    
    // Points Update (Earn 10 per 100)
    let newPts = userPoints + Math.floor(parseInt(finalBill)/10);
    if(isRedeeming) newPts -= 1000;
    await setDoc(doc(db, "users", userUID), { points: newPts }, { merge: true });

    localStorage.removeItem(`platto_cart_${resId}`);
    cart = [];
    document.getElementById('checkoutModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    document.getElementById('s-table').innerText = tableNo;
    loader.style.display = "none";
};

// ==========================================
// 5. HELPERS & AUTH
// ==========================================
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
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

window.setAuthMode = (mode) => {
    currentAuthMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
};

window.openTracking = async () => {
    const list = document.getElementById('order-history-list');
    list.innerHTML = "Loading...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = "";
    snap.forEach(d => {
        const o = d.data();
        list.innerHTML += `<div class="history-item"><b>${o.timestamp.toDate().toLocaleDateString()}</b> - ₹${o.total} [${o.status}]</div>`;
    });
    document.getElementById('trackingModal').style.display = "flex";
};

window.closeModal = (id) => document.getElementById(id).style.display = "none";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.redeemPoints = () => { isRedeeming = true; alert("Discount Applied!"); window.openCartModal(); };
window.logout = () => signOut(auth).then(() => location.reload());

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        document.getElementById('ann-title').innerText = restaurantData.annTitle || "Offer";
        document.getElementById('ann-desc').innerText = restaurantData.annText || "";
    }
}

init();