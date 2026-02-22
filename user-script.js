import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`pl_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup";
let isRedeeming = false;
let userUID = "";
let userPoints = 0;
let currentItem = null;
let currentAuthMode = "login";

const loader = document.getElementById('loader');

// ==========================================
// 1. LIVE ORDER TRACKING (FIXED)
// ==========================================
function checkLiveOrders() {
    if(!userUID) return;
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('order-history-list');
        if(!list) return;
        list.innerHTML = snap.empty ? "<p style='padding:20px;'>No active orders.</p>" : "";
        snap.forEach(d => {
            const o = d.data();
            if(o.status !== "Picked Up") {
                list.innerHTML += `
                <div class="history-item" style="border-left:5px solid var(--primary); margin-bottom:10px; padding:10px; background:#fff;">
                    <span style="float:right; font-weight:800; color:var(--primary);">${o.status}</span>
                    <b>Table ${o.table}</b><br>
                    <small>Total: ₹${o.total}</small>
                </div>`;
            }
        });
    });
}

// ==========================================
// 2. MENU LOADING (FIXED NULL CHECK)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return;
        grid.innerHTML = "";
        
        const vegToggle = document.getElementById('veg-toggle');
        const isVegOnly = vegToggle ? vegToggle.checked : false;
        
        const searchInput = document.getElementById('menu-search');
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(isVegOnly && !item.name.toLowerCase().includes('veg')) return;
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

// ==========================================
// 3. INITIALIZATION
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
        userUID = user ? user.uid : (localStorage.getItem('p_guest_id') || "g_" + Date.now());
        if(!user) localStorage.setItem('p_guest_id', userUID);
        
        const authBtn = document.getElementById('nav-auth-btn');
        const profBtn = document.getElementById('nav-profile-btn');
        if(authBtn) authBtn.style.display = user ? "none" : "flex";
        if(profBtn) profBtn.style.display = user ? "flex" : "none";
        
        const uSnap = await getDoc(doc(db, "users", userUID));
        if(uSnap.exists()) {
            userPoints = uSnap.data().points || 0;
            updatePointsUI();
        }
        loadMenu();
        checkLiveOrders(); // Now defined properly
    });
    updateCartUI();
}

function renderBranding() {
    const nameDisp = document.getElementById('res-name-display');
    const waitDisp = document.getElementById('wait-time');
    const aboutDisp = document.getElementById('res-about-text');
    const logoImg = document.getElementById('res-logo');

    if(nameDisp) nameDisp.innerText = restaurantData.name;
    if(waitDisp) waitDisp.innerText = restaurantData.prepTime || "20";
    if(aboutDisp) aboutDisp.innerText = restaurantData.about || "";
    if(logoImg && restaurantData.logoUrl) logoImg.src = restaurantData.logoUrl;
    
    const wifiBox = document.getElementById('wifi-display');
    if(restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
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
// 4. CUSTOMIZATION & CHECKOUT
// ==========================================
window.openCustomize = (id, item) => {
    currentItem = { ...item, id };
    document.getElementById('cust-item-name').innerText = item.name;
    document.getElementById('p-price-s').innerText = "₹" + item.price;
    document.getElementById('p-price-m').innerText = "₹" + (parseInt(item.price) + 50);
    document.getElementById('p-price-l').innerText = "₹" + (parseInt(item.price) + 100);
    
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
    let price = parseInt(currentItem.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    
    cart.push({ name: `${currentItem.name} (${size})`, price });
    localStorage.setItem(`pl_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.closeModal('customizeModal');
};

window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(sub < 300) { alert("Min ₹300 for delivery!"); window.setOrderType('Pickup'); return; }
        document.getElementById('delivery-info').style.display = "block";
    } else document.getElementById('delivery-info').style.display = "none";
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name");
    if(loader) loader.style.display = "flex";
    
    const finalBill = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        timestamp: new Date(), note: document.getElementById('chef-note').value,
        orderType: orderType
    };
    await addDoc(collection(db, "orders"), orderData);
    
    let newPts = userPoints + Math.floor(parseInt(finalBill)/10);
    if(isRedeeming) newPts -= 1000;
    await setDoc(doc(db, "users", userUID), { points: newPts }, { merge: true });

    localStorage.removeItem(`pl_cart_${resId}`);
    cart = [];
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    document.getElementById('s-table').innerText = tableNo;
    if(loader) loader.style.display = "none";
};

// ==========================================
// 5. GLOBAL UI HELPERS
// ==========================================
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

window.filterMenu = () => loadMenu();

window.updatePointsUI = () => {
    const ptsEl = document.getElementById('user-pts');
    const redeemBtn = document.getElementById('redeem-btn');
    if(ptsEl) ptsEl.innerText = userPoints;
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
};

window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price;
        list.innerHTML += `<div class="cart-item" style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee;"><span>${item.name}</span><b>₹${item.price}</b></div>`;
    });
    document.getElementById('summary-subtotal').innerText = "₹" + sub;
    document.getElementById('summary-total').innerText = "₹" + (isRedeeming ? sub - 10 : sub);
};

function updateCartUI() {
    const total = cart.reduce((s, i) => s + i.price, 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        bar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
    } else if(bar) bar.style.display = "none";
}

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        document.getElementById('qr-area').style.display = "block";
        const qrDiv = document.getElementById('payment-qr'); qrDiv.innerHTML = "";
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${document.getElementById('final-amt').innerText}`, width: 140, height: 140 });
    } else document.getElementById('qr-area').style.display = "none";
    document.getElementById('final-confirm-btn').disabled = false;
};

window.closeModal = (id) => { const m = document.getElementById(id); if(m) m.style.display = "none"; };
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.openProfileModal = () => {
    document.getElementById('profileModal').style.display = "flex";
    document.getElementById('user-profile-name').value = document.getElementById('cust-name-final').value;
};

window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try { await signInWithEmailAndPassword(auth, e, p); location.reload(); } 
    catch(err) { try { await createUserWithEmailAndPassword(auth, e, p); location.reload(); } catch(err2) { alert(err2.message); } }
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        document.getElementById('ann-title').innerText = restaurantData.annTitle;
        document.getElementById('ann-desc').innerText = restaurantData.annText;
    }
}

init();