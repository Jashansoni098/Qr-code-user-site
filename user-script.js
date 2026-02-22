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

// FIX: Only one declaration of cart
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

// ==========================================
// 2. INITIALIZATION (APP START)
// ==========================================

window.addToCart = (name, price) => {
    cart.push({ name, price });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    alert(name + " basket mein add ho gaya!");
};

async function init() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Invalid QR Code.</h3></div>";
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
        const navAuth = document.getElementById('nav-auth-btn');
        const navProf = document.getElementById('nav-profile-btn');

        if (user) {
            userUID = user.uid;
            if(navAuth) navAuth.style.display = "none";
            if(navProf) navProf.style.display = "flex";
            
            const uSnap = await getDoc(doc(db, "users", userUID));
            if(uSnap.exists()) {
                userPoints = uSnap.data().points || 0;
                if(document.getElementById('user-profile-name')) 
                    document.getElementById('user-profile-name').value = uSnap.data().name || "";
            }
        } else {
            if(navAuth) navAuth.style.display = "flex";
            if(navProf) navProf.style.display = "none";
        }
        updatePointsUI();
        loadMenu();
        checkLiveOrders(); 
    });
    updateCartUI();
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        const modal = document.getElementById('announcement-modal');
        if(modal) {
            modal.style.display = "flex";
            document.getElementById('ann-title').innerText = restaurantData.annTitle || "Offer";
            document.getElementById('ann-desc').innerText = restaurantData.annText || "";
        }
    }
}

// ==========================================
// 3. BRANDING, SOCIALS & WIFI
// ==========================================
function renderBranding() {
    if(document.getElementById('res-name-display')) document.getElementById('res-name-display').innerText = restaurantData.name;
    if(document.getElementById('wait-time')) document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    if(document.getElementById('res-about-text')) document.getElementById('res-about-text').innerText = restaurantData.about || "";
    if(document.getElementById('tbl-no')) document.getElementById('tbl-no').innerText = tableNo;
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    const wifiBox = document.getElementById('wifi-display');
    if(restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    if(document.getElementById('link-fb')) document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    if(document.getElementById('link-ig')) document.getElementById('link-ig').href = restaurantData.igLink || "#";
    if(document.getElementById('link-yt')) document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    if(document.getElementById('whatsapp-btn')) document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories && list) {
        list.innerHTML = `<button class="cat-pill active" onclick="window.filterByCategory('All', this)">All</button>`;
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

// ==========================================
// 4. MENU & CUSTOMIZATION
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
    
    if(document.getElementById('p-price-s')) document.getElementById('p-price-s').innerText = "₹" + item.price;
    if(document.getElementById('p-price-m')) document.getElementById('p-price-m').innerText = "₹" + (parseInt(item.price) + 50);
    if(document.getElementById('p-price-l')) document.getElementById('p-price-l').innerText = "₹" + (parseInt(item.price) + 100);

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
    const size = document.querySelector('input[name="p-size"]:checked').value;
    let finalPrice = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') finalPrice += 50;
    if(size === 'Large') finalPrice += 100;

    let extras = [];
    document.querySelectorAll('.ex-item:checked').forEach(el => {
        finalPrice += parseInt(el.dataset.price);
        extras.push(el.value);
    });

    cart.push({ 
        id: Date.now(), 
        name: `${currentItemToCustomize.name} (${size})`, 
        price: finalPrice, 
        extras: extras 
    });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    window.closeModal('customizeModal');
};

// ==========================================
// 5. CART & CHECKOUT LOGIC
// ==========================================
// ==========================================
// 4. FIX: CART & CHECKOUT LOGIC (Error-Free)
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Add items first!");
    window.closeModal('cartModal');
    
    const checkoutModal = document.getElementById('checkoutModal');
    if(checkoutModal) checkoutModal.style.display = "flex";
    
    const subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const finalAmtEl = document.getElementById('final-amt');
    
    // REDEEM Logic check
    if(finalAmtEl) {
        finalAmtEl.innerText = isRedeeming ? subtotal - 10 : subtotal;
    }
};

// FIX: Matching IDs with your HTML (type-pickup, type-delivery, delivery-address-box)
window.setOrderType = (type) => {
    orderType = type;
    const subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    
    const btnP = document.getElementById('type-pickup');
    const btnD = document.getElementById('type-delivery');
    const delBox = document.getElementById('delivery-address-box'); // Match with HTML

    if(btnP) btnP.classList.toggle('active', type === 'Pickup');
    if(btnD) btnD.classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        if(subtotal < 300) {
            alert("Min order ₹300 for delivery!");
            window.setOrderType('Pickup');
            return;
        }
        if(delBox) delBox.style.display = "block";
    } else {
        if(delBox) delBox.style.display = "none";
    }
};

// FIX: Matching IDs with your HTML (mode-online, mode-cash, payment-qr-area)
window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const mOnline = document.getElementById('mode-online');
    const mCash = document.getElementById('mode-cash');
    const qrArea = document.getElementById('payment-qr-area'); // Match with HTML

    if(mOnline) mOnline.classList.toggle('selected', mode === 'Online');
    if(mCash) mCash.classList.toggle('selected', mode === 'Cash');

    if(mode === 'Online' && qrArea) {
        qrArea.style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); // Match with HTML
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amt = document.getElementById('final-amt').innerText;
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        }
    } else if(qrArea) {
        qrArea.style.display = "none";
    }
    
    const finalBtn = document.getElementById('final-place-btn');
    if(finalBtn) finalBtn.disabled = false;
};

// FIX: Success Screen IDs
window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    const name = nameInput ? nameInput.value.trim() : "";
    if(!name) return alert("Enter Name!");
    
    if(loader) loader.style.display = "flex";
    const finalAmt = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalAmt, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value,
        address: document.getElementById('cust-address').value || "At Table"
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        // Loyalty logic
        const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const snap = await getDoc(userRef);
        let pts = snap.exists() ? snap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned }, { merge: true });

        // Show success screen
        window.closeModal('checkoutModal');
        const successEl = document.getElementById('success-screen');
        if(successEl) successEl.style.display = "flex";
        
        const sName = document.getElementById('s-name');
        const sTable = document.getElementById('s-table');
        if(sName) sName.innerText = name;
        if(sTable) sTable.innerText = tableNo;

        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = "none";
};
// ==========================================
// 6. ORDER CONFIRMATION
// ==========================================
window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name!");
    
    if(loader) loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalTotal, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value,
        address: document.getElementById('cust-address').value || "At Table"
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        const earned = Math.floor(parseInt(finalTotal) / 100) * 10;
        if(userUID) {
            const userRef = doc(db, "users", userUID);
            const snap = await getDoc(userRef);
            let pts = snap.exists() ? snap.data().points : 0;
            if(isRedeeming) pts -= 1000;
            await setDoc(userRef, { points: pts + earned }, { merge: true });
        }

        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        document.getElementById('checkoutModal').style.display = "none";
        document.getElementById('success-screen').style.display = "flex";
        document.getElementById('s-name').innerText = name;
        document.getElementById('s-table').innerText = tableNo;
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 7. UTILS & HELPERS
// ==========================================
function updatePointsUI() {
    const ptsEl = document.getElementById('user-pts');
    const redeemBtn = document.getElementById('redeem-btn');
    if(ptsEl) ptsEl.innerText = userPoints;
    if(redeemBtn) redeemBtn.disabled = (userPoints < 1000);
}

window.redeemPoints = () => { 
    isRedeeming = true; 
    alert("Discount Applied! Redeming 1000 points."); 
    window.openCartModal(); 
};

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

window.filterMenu = () => loadMenu();

window.openHistoryModal = async () => {
    const list = document.getElementById('order-history-list');
    if(!list) return;
    list.innerHTML = "Fetching history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
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
    onSnapshot(q, (snap) => {
        // Real-time tracking can be added here
    });
}

window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    try {
        if(currentAuthMode === 'login') await signInWithEmailAndPassword(auth, email, pass);
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

window.setAuthMode = (mode) => {
    currentAuthMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
};

window.closeModal = (id) => { const m = document.getElementById(id); if(m) m.style.display = "none"; };
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.openTracking = () => window.openHistoryModal();
window.logout = () => signOut(auth).then(() => location.reload());

init();