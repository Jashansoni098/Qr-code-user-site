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

// --- SAFETY HELPERS ---
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

// ==========================================
// 3. MENU & CUSTOMIZATION (S/M/L logic)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        const searchInput = document.getElementById('menu-search');
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(search && !item.name.toLowerCase().includes(search)) return;

            const hasSizes = (item.priceM > 0 || item.priceL > 0);
            const clickAction = hasSizes 
                ? `window.openCustomize("${d.id}", ${JSON.stringify(item).replace(/'/g, "&apos;")})`
                : `window.addToCart("${item.name}", ${item.price})`;

            grid.innerHTML += `
                <div class="food-card" onclick='${clickAction}'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}${hasSizes ? ' +' : ''}</b>
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
    
    // FIX: Match with HTML ID "size-options"
    const sizeBox = document.getElementById('size-options');
    if(sizeBox) {
        let html = `<label class="option-row"><input type="radio" name="p-size" value="Regular" checked> Regular <span>₹${item.price}</span></label>`;
        if(item.priceM) html += `<label class="option-row"><input type="radio" name="p-size" value="Medium"> Medium <span>₹${item.priceM}</span></label>`;
        if(item.priceL) html += `<label class="option-row"><input type="radio" name="p-size" value="Large"> Large <span>₹${item.priceL}</span></label>`;
        sizeBox.innerHTML = html;
    }

    // Ingredients & Extras logic
    const extrasDiv = document.getElementById('extras-options');
    if(extrasDiv) {
        extrasDiv.innerHTML = item.ingredients ? `<p style="font-size:0.8rem; color:gray; margin-bottom:10px; text-align:left;">📝 ${item.ingredients}</p>` : "";
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
// 4. BASKET LOGIC (+/- & Quantity)
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

// ==========================================
// 5. CHECKOUT & ORDER
// ==========================================
window.openCheckoutModal = () => {
    window.closeModal('cartModal');
    const modal = document.getElementById('checkoutModal');
    if(modal) modal.style.display = "flex";
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', (sub - (isRedeeming ? 10 : 0) - couponDiscount));
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), instruction: document.getElementById('chef-note') ? document.getElementById('chef-note').value : "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : "At Table"
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameEl.value); setUI('s-table', tableNo);
        
        const earned = Math.floor(parseInt(finalBill)/100)*10;
        const userRef = doc(db, "users", userUID);
        const uSnap = await getDoc(userRef);
        let pts = uSnap.exists() ? uSnap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned, name: nameEl.value }, { merge: true });
        localStorage.removeItem(`platto_cart_${resId}`); cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 6. HELPERS & OTHERS
// ==========================================
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
        list.innerHTML = `<button class="cat-pill active" onclick="window.filterByCategory('All', this)">All</button>`;
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) cart[index].qty++;
    else cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    saveCart();
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    document.getElementById('final-place-btn').disabled = false;
};

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.openTrackingModal = () => showFlex('trackingModal');
window.openHistoryModal = () => showFlex('historyModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};
window.filterMenu = () => loadMenu();
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if(btn) btn.disabled = userPoints < 1000;
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

init();