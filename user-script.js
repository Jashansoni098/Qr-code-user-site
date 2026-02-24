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
let couponDiscount = 0;
let appliedCouponCode = "";
let currentAuthMode = "login";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;

const loader = document.getElementById('loader');

// --- SAFETY HELPER: UI UPDATE (Prevents Null Errors) ---
const setUI = (id, val) => { 
    const el = document.getElementById(id); 
    if(el) {
        if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
        else el.innerText = val;
    }
};
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
        if (user) {
            userUID = user.uid;
            showEl('nav-auth-btn', false);
            showEl('nav-profile-btn');
            
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                    setUI('user-profile-name', uSnap.data().name || "");
                    setUI('user-profile-phone', uSnap.data().phone || "");
                    setUI('cust-name-final', uSnap.data().name || "");
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

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(document.getElementById('hero-banner-img') && restaurantData.bannerUrl) document.getElementById('hero-banner-img').src = restaurantData.bannerUrl;

    if(restaurantData.wifiName) {
        showFlex('wifi-display');
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    // Socials
    const socials = { 'link-fb': 'fbLink', 'link-ig': 'igLink', 'link-yt': 'ytLink' };
    for(let id in socials) { if(document.getElementById(id)) document.getElementById(id).href = restaurantData[socials[id]] || "#"; }
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
// 3. MENU & CUSTOMIZATION (S/M/L logic)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        const search = document.getElementById('menu-search') ? document.getElementById('menu-search').value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(search && !item.name.toLowerCase().includes(search)) return;

            grid.innerHTML += `
                <div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item).replace(/'/g, "&apos;")})'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}</b>
                        <button class="add-btn" style="width:100%; margin-top:8px;">ADD +</button>
                    </div>
                </div>`;
        });
        showEl('loader', false);
    });
}

window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    setUI('cust-item-name', item.name);
    
    // Fill Sizes
    const sizeBox = document.getElementById('size-options-container');
    if(sizeBox) {
        sizeBox.innerHTML = `<label class="option-row"><input type="radio" name="p-size" value="Regular" checked> Regular <span>₹${item.price}</span></label>`;
        if(item.priceM) sizeBox.innerHTML += `<label class="option-row"><input type="radio" name="p-size" value="Medium"> Medium <span>₹${item.priceM}</span></label>`;
        if(item.priceL) sizeBox.innerHTML += `<label class="option-row"><input type="radio" name="p-size" value="Large"> Large <span>₹${item.priceL}</span></label>`;
    }

    const extrasDiv = document.getElementById('extras-options');
    if(extrasDiv) {
        extrasDiv.innerHTML = "";
        if(restaurantData.variants) {
            restaurantData.variants.forEach(v => {
                extrasDiv.innerHTML += `<label class="option-row">
                    <span><input type="checkbox" class="ex-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span>
                    <b>+₹${v.price}</b>
                </label>`;
            });
        }
    }
    showFlex('customizeModal');
};

window.addCustomizedToCart = () => {
    const sizeInput = document.querySelector('input[name="p-size"]:checked');
    const size = sizeInput ? sizeInput.value : "Regular";
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price = parseInt(currentItemToCustomize.priceM) || (price + 50);
    if(size === 'Large') price = parseInt(currentItemToCustomize.priceL) || (price + 100);
    
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    saveCart();
    window.closeModal('customizeModal');
};

// ==========================================
// 4. BASKET & QUANTITY Logic
// ==========================================
function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if(document.getElementById('cart-badge-count')) document.getElementById('cart-badge-count').innerText = totalQty;
    } else if(bar) showEl('cart-bar', false);
}

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = cart.length === 0 ? "<div style='padding:40px; color:gray;'>Basket is empty</div>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        sub += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${itemTotal}</div>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));

    let finalTotal = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (finalTotal < 0 ? 0 : finalTotal));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    if (appliedCouponCode) { couponDiscount = 0; appliedCouponCode = ""; setUI('coupon-msg', ""); }
    saveCart(); window.renderCartList();
};

window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if (!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const c = snap.docs[0].data();
            if (subtotal < c.minOrder) return alert(`Min order ₹${c.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Applied! ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon");
    } catch(e) { alert("Coupon Error"); }
};

// ==========================================
// 5. CHECKOUT & DELIVERY Logic
// ==========================================
window.openCheckoutModal = () => {
    window.closeModal('cartModal');
    const modal = document.getElementById('checkoutModal');
    if(modal) modal.style.display = "flex";
    
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const final = subtotal - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', (final < 0 ? 0 : final));
};

window.setOrderType = (type) => {
    orderType = type;
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const minDlv = parseInt(restaurantData.minOrder) || 0;
    
    if(document.getElementById('type-pickup')) document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    if(document.getElementById('type-delivery')) document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        if(subtotal < minDlv) {
            alert(`Delivery ke liye minimum order ₹${minDlv} hona chahiye!`);
            window.setOrderType('Pickup');
            return;
        }
        setUI('delivery-dynamic-msg', `⚠️ Delivery within ${restaurantData.maxKM || 3}KM (Min Order ₹${minDlv})`);
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    if(document.getElementById('mode-online')) document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    if(document.getElementById('mode-cash')) document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    
    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr');
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amt = document.getElementById('final-amt').innerText;
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
            setUI('final-upi-id', "UPI: " + restaurantData.upiId);
        }
    } else showEl('payment-qr-area', false);
    if(document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};

// ==========================================
// 6. CONFIRM ORDER
// ==========================================
// ==========================================
// 6. CONFIRM ORDER & SUCCESS SCREEN FIX
// ==========================================
window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    const finalAmtEl = document.getElementById('final-amt');
    const checkoutModal = document.getElementById('checkoutModal');
    const successScreen = document.getElementById('success-screen');

    // Validation
    const name = nameInput ? nameInput.value.trim() : "";
    if(!name) return alert("Kripya apna naam bhariye!");
    
    // Start Loader
    if(loader) loader.style.display = "flex";
    
    try {
        const finalBill = finalAmtEl ? finalAmtEl.innerText : "0";
        
        const orderData = {
            resId, 
            table: tableNo, 
            customerName: name, 
            userUID, 
            items: cart,
            total: finalBill, 
            status: "Pending", 
            paymentMode: selectedPaymentMode,
            orderType: orderType,
            timestamp: new Date(), 
            instruction: document.getElementById('chef-note') ? document.getElementById('chef-note').value : "",
            address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : "At Table"
        };

        // 1. Firebase mein Order bhejein
        await addDoc(collection(db, "orders"), orderData);
        
        // 2. Checkout Modal ko ZABARDASTI band karein
        if(checkoutModal) checkoutModal.style.display = "none";

        // 3. Success Screen (Thank You) dikhayein
        if(successScreen) {
            successScreen.style.display = "flex";
            setUI('s-name', name);
            setUI('s-table', tableNo);
        }

        // 4. Loyalty Points Update logic
        const earned = Math.floor(parseInt(finalBill) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const snap = await getDoc(userRef);
        let pts = snap.exists() ? snap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned, name: name }, { merge: true });

        // 5. Cart aur Storage poori tarah saaf karein
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        updateCartUI();

    } catch(e) { 
        console.error("Order error:", e);
        alert("Order fail ho gaya: " + e.message); 
    } finally {
        if(loader) loader.style.display = "none";
    }
};

// --- Success Screen close karne ka function ---
window.closeSuccess = () => {
    const success = document.getElementById('success-screen');
    if(success) success.style.display = "none";
    location.reload(); // Page refresh karein taaki fresh menu dikhe
};

// ==========================================
// 7. TRACKING & HISTORY
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if(!list) return; list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if(["Pending", "Preparing", "Ready"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item" style="border-left:4px solid var(--primary);">
                    <span style="float:right; color:var(--primary); font-weight:800;">${o.status}</span>
                    <b>Table ${o.table}</b><br><small>Total: ₹${o.total}</small>
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
    list.innerHTML = "Loading history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Rejected") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

// ==========================================
// 8. OTHERS (AUTH, WIFI, ANNOUNCEMENT)
// ==========================================
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if(btn) btn.disabled = userPoints < 1000;
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
    const n = document.getElementById('user-profile-name').value;
    const ph = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name: n, phone: ph }, { merge: true });
    alert("Saved!"); window.closeModal('profileModal');
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active'); loadMenu(cat);
};
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => currentAuthMode = m;
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.filterMenu = () => loadMenu();

init();