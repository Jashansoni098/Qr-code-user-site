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
    if(restaurantData.wifiName) {
        showFlex('wifi-display');
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
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div class="food-info"><h4>${item.name}</h4><b class="food-price">₹${item.price}</b></div></div>`;
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
                extrasDiv.innerHTML += `<label class="option-row"><span><input type="checkbox" class="ex-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span><b>+₹${v.price}</b></label>`;
            });
        }
    }
    showFlex('customizeModal');
};

window.addCustomizedToCart = () => {
    const sizeInput = document.querySelector('input[name="p-size"]:checked');
    const size = sizeInput ? sizeInput.value : "Regular";
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.closeModal('customizeModal');
};

// ==========================================
// 5. BASKET LOGIC
// ==========================================
function updateCartUI() {
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    if(cart.length > 0) {
        showFlex('cart-bar');
        setUI('cart-qty', cart.length);
        setUI('cart-total', totalAmt);
        setUI('cart-badge-count', cart.length);
    } else {
        showEl('cart-bar', false);
    }
}

window.openCartModal = () => {
    showFlex('cartModal');
    const list = document.getElementById('cart-items-list');
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px;'>Basket is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price * item.qty;
        list.innerHTML += `<div class="cart-item" style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee;">
            <div style="text-align:left;"><b>${item.name}</b><br><small>₹${item.price}</small></div>
            <div style="display:flex; align-items:center; gap:10px;">
                <button onclick="window.changeQty(${index}, -1)" class="badge">-</button>
                <b>${item.qty}</b>
                <button onclick="window.changeQty(${index}, 1)" class="badge">+</button>
            </div>
            <b>₹${item.price * item.qty}</b>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('summary-total', "₹" + (isRedeeming ? sub - 10 : sub));
    showFlex('discount-line', isRedeeming);
};

window.changeQty = (index, delta) => {
    cart[index].qty += delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.openCartModal();
};

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', isRedeeming ? sub - 10 : sub);
};

// ==========================================
// 6. FIX: TRACKING MODAL (Newly Added)
// ==========================================
window.openTrackingModal = () => {
    const modal = document.getElementById('trackingModal');
    if(modal) {
        modal.style.display = "flex";
        const list = document.getElementById('live-tracking-list');
        if(list) list.innerHTML = "Fetching status..."; 
        
        const q = query(collection(db, "orders"), where("userUID", "==", userUID));
        onSnapshot(q, (snap) => {
            if(!list) return;
            list.innerHTML = "";
            let hasActive = false;
            snap.forEach(d => {
                const o = d.data();
                if(!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                    hasActive = true;
                    list.innerHTML += `<div class="history-item" style="border-left:5px solid var(--primary); padding:10px; margin-bottom:10px; background:#fff;">
                        <span style="float:right; font-weight:800; color:var(--primary);">${o.status}</span>
                        <b>Table ${o.table}</b><br><small>Total Bill: ₹${o.total}</small>
                    </div>`;
                }
            });
            if(!hasActive) list.innerHTML = "<p style='padding:20px;'>No active orders.</p>";
        });
    }
};

// ==========================================
// 7. FIX: SET PAY MODE (Matching IDs)
// ==========================================
window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const btnO = document.getElementById('mode-online');
    const btnC = document.getElementById('mode-cash');
    if(btnO) btnO.classList.toggle('selected', mode === 'Online');
    if(btnC) btnC.classList.toggle('selected', mode === 'Cash');

    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online') {
        if(qrArea) qrArea.style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); 
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amtEl = document.getElementById('final-amt');
            const amt = amtEl ? amtEl.innerText : "0";
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        }
    } else {
        if(qrArea) qrArea.style.display = "none";
    }
    
    const confirmBtn = document.getElementById('final-place-btn');
    if(confirmBtn) confirmBtn.disabled = false;
};

// ==========================================
// 8. FIX: CONFIRM ORDER (Success & Points)
// ==========================================
window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    const finalAmtEl = document.getElementById('final-amt');
    
    if(!nameInput || nameInput.value.trim() === "") return alert("Please enter your name!");
    
    if(loader) loader.style.display = "flex";
    
    try {
        const finalBill = finalAmtEl ? finalAmtEl.innerText : "0";
        const orderData = {
            resId, table: tableNo, customerName: nameInput.value, userUID, 
            items: cart, total: finalBill, status: "Pending", 
            paymentMode: selectedPaymentMode, orderType, 
            timestamp: new Date(), note: document.getElementById('chef-note').value || ""
        };

        await addDoc(collection(db, "orders"), orderData);
        
        // Update Loyalty Points (₹100 = 10 pts)
        const earned = Math.floor(parseInt(finalBill) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const snap = await getDoc(userRef);
        let pts = snap.exists() ? snap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned, name: nameInput.value }, { merge: true });

        // Show success screen
        window.closeModal('checkoutModal');
        const successEl = document.getElementById('success-screen');
        if(successEl) successEl.style.display = "flex";
        setUI('s-name', nameInput.value);
        setUI('s-table', tableNo);
        
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        updateCartUI();
    } catch(e) { 
        console.error(e);
        alert("Order failed! Please try again."); 
    }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 9. HISTORY, AUTH & UTILS
// ==========================================
window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if(!list) return;
    list.innerHTML = "Loading...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p style='padding:20px;'>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Done") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
            list.innerHTML += `<div class="history-item" style="padding:15px; border-bottom:1px solid #eee; text-align:left;"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

function checkLiveOrders() {} // Logic merged in TrackingModal

window.updatePointsUI = () => {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
};

window.setOrderType = (type) => {
    orderType = type;
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    const delBox = document.getElementById('delivery-address-box');
    if(type === 'Delivery') {
        const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
        if(sub < 300) { alert("Min order ₹300 for delivery!"); window.setOrderType('Pickup'); return; }
        if(delBox) delBox.style.display = "block";
    } else if(delBox) { delBox.style.display = "none"; }
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
    alert("Profile Saved!");
    window.closeModal('profileModal');
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};
window.filterMenu = () => loadMenu();
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => currentAuthMode = m;
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };

init();