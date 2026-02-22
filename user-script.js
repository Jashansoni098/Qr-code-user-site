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
let isRedeeming = false; // Loyalty Points
let discountAmount = 0;   // Coupon Discount
let appliedCouponCode = "";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;

// Safety Helpers
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

    // Fetch Restaurant Settings
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        renderCategories();
        handleAnnouncement(); // Announcement logic
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userUID = user.uid;
            showEl('nav-auth-btn', false);
            showFlex('nav-profile-btn');
            
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                }
            });
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            showFlex('nav-auth-btn');
            showEl('nav-profile-btn', false);
        }
        loadMenu();
    });
    updateCartUI();
}

// ==========================================
// 3. ANNOUNCEMENT POPUP
// ==========================================
function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        setTimeout(() => {
            showFlex('announcement-modal');
            setUI('ann-title', restaurantData.annTitle || "Special Offer");
            setUI('ann-desc', restaurantData.annText || "Welcome to our restaurant!");
        }, 800);
    }
}

// ==========================================
// 4. BASKET & QUANTITY (FIXED LAYOUT)
// ==========================================
window.openCartModal = () => {
    showFlex('cartModal');
    const list = document.getElementById('cart-items-list');
    if(!list) return;
    
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px; text-align:center;'>Your basket is empty</p>" : "";
    let subtotal = 0;

    cart.forEach((item, index) => {
        subtotal += item.price * item.qty;
        list.innerHTML += `
        <div class="cart-item">
            <div class="cart-item-info">
                <b>${item.name}</b>
                <small>₹${item.price}</small>
            </div>
            <div class="qty-btn-box">
                <button onclick="window.changeQty(${index}, -1)">-</button>
                <span>${item.qty}</span>
                <button onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div class="cart-item-price">₹${item.price * item.qty}</div>
        </div>`;
    });

    const finalDiscount = discountAmount + (isRedeeming ? 10 : 0);
    const total = subtotal - finalDiscount;

    setUI('summary-subtotal', "₹" + subtotal);
    setUI('summary-total', "₹" + (total < 0 ? 0 : total));
    setUI('available-pts', userPoints);
    
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));
    
    if(finalDiscount > 0) {
        showFlex('discount-line');
        setUI('summary-discount', "-₹" + finalDiscount);
    } else {
        showEl('discount-line', false);
    }
};

window.changeQty = (index, delta) => {
    cart[index].qty += delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    saveCart();
    window.openCartModal(); // Refresh UI
};

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
        setUI('cart-qty', totalQty);
        setUI('cart-total', totalAmt);
        setUI('cart-badge-count', totalQty);
    } else if(bar) showEl('cart-bar', false);
}

// ==========================================
// 5. COUPON LOGIC
// ==========================================
window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('coupon-status-msg');
    
    if(!code) return alert("Enter coupon code!");

    try {
        // Checking for: restaurants/{resId}/coupons/{code}
        const couponRef = doc(db, "restaurants", resId, "coupons", code);
        const couponSnap = await getDoc(couponRef);

        if(couponSnap.exists()) {
            const cData = couponSnap.data();
            if(cData.active) {
                discountAmount = parseInt(cData.value || 0);
                appliedCouponCode = code;
                statusMsg.innerText = "Coupon Applied Successfully!";
                statusMsg.style.color = "green";
                window.openCartModal();
            } else {
                throw new Error("This coupon is expired.");
            }
        } else {
            throw new Error("Invalid coupon code.");
        }
    } catch(err) {
        discountAmount = 0;
        appliedCouponCode = "";
        statusMsg.innerText = err.message;
        statusMsg.style.color = "red";
        window.openCartModal();
    }
};

// ==========================================
// 6. CONFIRM ORDER (CHEF NOTE FIX)
// ==========================================
window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    const note = document.getElementById('chef-note').value; // Correctly capturing note

    if(!name) return alert("Please enter your name!");
    if(!selectedPaymentMode) return alert("Select Payment Mode!");

    showEl('loader', true);
    
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const finalBill = sub - discountAmount - (isRedeeming ? 10 : 0);

    const orderData = {
        resId,
        table: tableNo,
        customerName: name,
        userUID,
        items: cart,
        total: finalBill < 0 ? 0 : finalBill,
        status: "Pending",
        paymentMode: selectedPaymentMode,
        orderType,
        timestamp: new Date(),
        note: note, // "note" field goes to Admin Panel
        coupon: appliedCouponCode,
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        // Update Loyalty Points (₹100 = 10pts)
        const earned = Math.floor(parseInt(finalBill)/10);
        let newPts = userPoints + earned; if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: name }, { merge: true });

        // Reset App State
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        discountAmount = 0;
        appliedCouponCode = "";
        isRedeeming = false;
        
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', name);
    } catch(e) { 
        alert("Error: " + e.message); 
    }
    showEl('loader', false);
};

// ==========================================
// 7. OTHER UTILS (UNCHANGED)
// ==========================================
window.redeemPoints = () => { 
    if(userPoints >= 1000) {
        isRedeeming = true; 
        alert("Loyalty Reward Applied!"); 
        window.openCartModal(); 
    } else {
        alert("Insufficient points!");
    }
};

window.setOrderType = (type) => {
    orderType = type;
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    showEl('delivery-address-box', type === 'Delivery');
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('summary-total').innerText.replace('₹','');
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    document.getElementById('final-place-btn').disabled = false;
};

// Initial Branding & Functions
function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(restaurantData.wifiName) {
        showFlex('wifi-display');
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
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

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return;
        grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `
                <div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}</b>
                    </div>
                </div>`;
        });
        showEl('loader', false);
    });
}

window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    setUI('cust-item-name', item.name);
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', "₹" + (parseInt(item.price) + 100));
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
    showFlex('customizeModal');
};

window.addCustomizedToCart = () => {
    const sizeInput = document.querySelector('input[name="p-size"]:checked');
    const size = sizeInput ? sizeInput.value : "Regular";
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    saveCart();
    window.closeModal('customizeModal');
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if(btn) btn.disabled = userPoints < 1000;
}

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};

init();