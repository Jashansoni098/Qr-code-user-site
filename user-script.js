import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = [];
let total = 0;
let restaurantData = {};
let selectedPaymentMode = "";
let userUID = localStorage.getItem('platto_uid') || "u_" + Date.now();
localStorage.setItem('platto_uid', userUID);

const loader = document.getElementById('loader');

// --- 1. Initialization ---
async function initApp() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Please scan the QR code at your table.</h3></div>";
        return;
    }

    try {
        // Fetch Restaurant Data
        const resRef = doc(db, "restaurants", resId);
        const resSnap = await getDoc(resRef);
        if (resSnap.exists()) {
            restaurantData = resSnap.data();
            document.getElementById('res-name-display').innerText = restaurantData.name;
            document.getElementById('res-address-display').innerText = restaurantData.address || "Digital Menu Enabled";
            document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
            document.getElementById('res-about-text').innerText = restaurantData.about || "Enjoy our authentic food experience.";
            document.getElementById('tbl-no').innerText = tableNo;
            if (restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
            
            // WhatsApp button
            document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
        }

        fetchLoyalty();
        loadMenu();
        checkLiveOrders();
    } catch (err) {
        console.error("Init Error:", err);
    }
}

// --- 2. Loyalty Points Logic ---
async function fetchLoyalty() {
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
}

// --- 3. Menu & Filtering ---
function loadMenu() {
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const container = document.getElementById('menu-list');
        container.innerHTML = "";
        const isVegOnly = document.getElementById('veg-toggle').checked;
        const searchQuery = document.getElementById('menu-search').value.toLowerCase();

        snapshot.forEach(d => {
            const item = d.data();
            if (isVegOnly && !item.name.toLowerCase().includes('veg')) return;
            if (searchQuery && !item.name.toLowerCase().includes(searchQuery)) return;

            container.innerHTML += `
                <div class="food-card">
                    <div class="food-details">
                        <h4>${item.name}</h4>
                        <div class="food-price">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        if(loader) loader.style.display = 'none';
    });
}

window.filterMenu = () => loadMenu();

window.addToCart = (name, price) => {
    cart.push({ name, price });
    total += parseInt(price);
    updateCartUI();
};

function updateCartUI() {
    if (cart.length > 0) {
        document.getElementById('cart-bar').style.display = 'flex';
        document.getElementById('cart-qty').innerText = `${cart.length} Items`;
        document.getElementById('cart-total').innerText = total;
    }
}

// --- 4. New Checkout & Payment Logic ---
window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = 'flex';
    
    // Loyalty Discount Check (1000 pts = ₹10 Off)
    let finalPayable = total;
    const pts = parseInt(document.getElementById('user-pts').innerText);
    const discountMsg = document.getElementById('loyalty-discount-msg');
    
    if(pts >= 1000) {
        finalPayable = total - 10;
        if(discountMsg) discountMsg.style.display = 'block';
    } else {
        if(discountMsg) discountMsg.style.display = 'none';
    }
    
    document.getElementById('final-amt').innerText = finalPayable < 0 ? 0 : finalPayable;
    
    // Reset Modal UI
    selectedPaymentMode = "";
    document.getElementById('online-qr-section').style.display = 'none';
    document.getElementById('cash-msg-section').style.display = 'none';
    document.getElementById('final-confirm-btn').disabled = true;
    document.querySelectorAll('.pay-choice-btn').forEach(b => b.classList.remove('selected'));
};

window.selectPaymentMode = (mode) => {
    selectedPaymentMode = mode;
    document.querySelectorAll('.pay-choice-btn').forEach(b => b.classList.remove('selected'));
    
    if(mode === 'Online') {
        document.getElementById('btn-pay-online').classList.add('selected');
        document.getElementById('online-qr-section').style.display = 'block';
        document.getElementById('cash-msg-section').style.display = 'none';
        
        // Generate UPI QR for Manual Scan
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const finalAmt = document.getElementById('final-amt').innerText;
        const upiLink = `upi://pay?pa=${restaurantData.upiId}&pn=${restaurantData.name}&am=${finalAmt}&cu=INR`;
        new QRCode(qrDiv, { text: upiLink, width: 150, height: 150 });
        document.getElementById('display-upi-id').innerText = restaurantData.upiId;
    } else {
        document.getElementById('btn-pay-cash').classList.add('selected');
        document.getElementById('online-qr-section').style.display = 'none';
        document.getElementById('cash-msg-section').style.display = 'block';
    }
    
    document.getElementById('final-confirm-btn').disabled = false;
};

window.copyUPI = () => {
    navigator.clipboard.writeText(restaurantData.upiId);
    alert("UPI ID Copied! Ab apne kisi bhi app se payment kar dein.");
};

// --- 5. Order Confirmation ---
window.confirmOrder = async () => {
    const custName = document.getElementById('cust-name').value.trim();
    if(!custName) return alert("Kripya apna naam bhariye!");
    
    const finalAmt = parseInt(document.getElementById('final-amt').innerText);
    const instruction = document.getElementById('chef-instruction').value;

    if(loader) loader.style.display = 'flex';

    try {
        const orderData = {
            resId: resId,
            table: tableNo,
            customerName: custName,
            paymentMode: selectedPaymentMode,
            items: cart,
            total: finalAmt, 
            status: "Pending",
            timestamp: new Date(), 
            instruction: instruction,
            userUID: userUID
        };

        // Firebase mein order bhejna
        await addDoc(collection(db, "orders"), orderData);

        // Loyalty points update
        const earned = Math.floor(total / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const userSnap = await getDoc(userRef);
        let currentPts = userSnap.exists() ? userSnap.data().points : 0;
        if(currentPts >= 1000) currentPts -= 1000;
        await setDoc(userRef, { points: currentPts + earned }, { merge: true });

        // SHOW SUCCESS SCREEN
        document.getElementById('paymentModal').style.display = 'none';
        document.getElementById('success-screen').style.display = 'flex';
        document.getElementById('summary-name').innerText = custName;
        document.getElementById('summary-table').innerText = tableNo;

        // Reset Cart
        cart = []; total = 0;
        document.getElementById('cart-bar').style.display = 'none';

    } catch (e) {
        alert("Error: " + e.message);
    }
    if(loader) loader.style.display = 'none';
};

window.closeSuccess = () => {
    document.getElementById('success-screen').style.display = 'none';
    location.reload(); // Wapas fresh menu par
};

// --- 6. Live Tracking & Invoice ---
function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), where("status", "!=", "Picked Up"));
    onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            const order = snapshot.docs[0].data();
            const banner = document.getElementById('tracking-banner');
            if(banner) {
                banner.style.display = 'flex';
                document.getElementById('track-status-text').innerText = getMsg(order.status);
                if(order.status === "Ready") document.getElementById('download-bill-btn').style.display = 'block';
                window.activeOrder = order;
            }
        }
    });
}

function getMsg(s) {
    if(s === "Pending") return "Order Received! Kitchen line mein hai...";
    if(s === "Preparing") return "Chef is cooking your meal... 🔥";
    if(s === "Ready") return "Your food is ready! ✅ Please collect.";
    return "Status Update...";
}

window.generateInvoice = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const order = window.activeOrder;
    doc.setFontSize(20);
    doc.text(restaurantData.name || "Platto Receipt", 10, 20);
    doc.setFontSize(12);
    doc.text(`Customer: ${order.customerName}`, 10, 30);
    doc.text(`Table: ${order.table} | Mode: ${order.paymentMode}`, 10, 40);
    doc.text(`Date: ${new Date().toLocaleString()}`, 10, 50);
    doc.line(10, 55, 200, 55);
    doc.text(`Total Payable: INR ${order.total}`, 10, 70);
    doc.text(`Thank you for visiting!`, 10, 90);
    doc.save(`Platto_Bill_${order.table}.pdf`);
};

window.closeModal = () => document.getElementById('paymentModal').style.display = 'none';

// Start App
initApp();