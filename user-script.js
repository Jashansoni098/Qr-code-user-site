import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = [];
let total = 0;
let restaurantData = {};
let userUID = localStorage.getItem('platto_uid') || "u_" + Date.now();
localStorage.setItem('platto_uid', userUID);

// --- Initialization ---
async function initApp() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Please scan the QR code at your table.</h3></div>";
        return;
    }

    // 1. Fetch Restaurant Data
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

    // 2. Load Loyalty Points
    fetchLoyalty();

    // 3. Real-time Menu
    loadMenu();

    // 4. Order Tracking
    checkLiveOrders();
}

async function fetchLoyalty() {
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
}

function loadMenu() {
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const container = document.getElementById('menu-list');
        container.innerHTML = "";
        const isVegOnly = document.getElementById('veg-toggle').checked;

        snapshot.forEach(d => {
            const item = d.data();
            // Filter logic
            if (isVegOnly && !item.name.toLowerCase().includes('veg')) return;

            container.innerHTML += `
                <div class="food-card">
                    <div class="food-details">
                        <h4>${item.name}</h4>
                        <div class="food-price">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        document.getElementById('loader').style.display = 'none';
    });
}

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

// --- Order & Payment ---
window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = 'flex';
    document.getElementById('final-amt').innerText = total;
    const pts = parseInt(document.getElementById('user-pts').innerText);
    if(pts >= 1000) document.getElementById('loyalty-discount-msg').style.display = 'block';

    // UPI QR
    const qrDiv = document.getElementById('payment-qr');
    qrDiv.innerHTML = "";
    const upiLink = `upi://pay?pa=${restaurantData.upiId}&pn=${restaurantData.name}&am=${total}&cu=INR`;
    new QRCode(qrDiv, { text: upiLink, width: 150, height: 150 });
};

window.payViaUPI = () => {
    const upiLink = `upi://pay?pa=${restaurantData.upiId}&pn=${restaurantData.name}&am=${total}&cu=INR`;
    window.location.href = upiLink;
};

window.confirmOrder = async () => {
    const instruction = document.getElementById('chef-instruction').value;
    const orderData = {
        resId, table: tableNo, items: cart, total, 
        status: "Pending", timestamp: new Date(), 
        instruction, userUID
    };

    await addDoc(collection(db, "orders"), orderData);

    // Update Loyalty (10 pts for every 100)
    const earned = Math.floor(total / 100) * 10;
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let currentPts = userSnap.exists() ? userSnap.data().points : 0;
    if(currentPts >= 1000) currentPts -= 1000;
    await setDoc(userRef, { points: currentPts + earned }, { merge: true });

    alert("Order successfully sent to kitchen!");
    location.reload();
};

// --- Live Tracking ---
function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), where("status", "!=", "Picked Up"));
    onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            const order = snapshot.docs[0].data();
            const banner = document.getElementById('tracking-banner');
            banner.style.display = 'flex';
            document.getElementById('track-status-text').innerText = getMsg(order.status);
            if(order.status === "Ready") document.getElementById('download-bill-btn').style.display = 'block';
            window.activeOrder = order;
        }
    });
}

function getMsg(s) {
    if(s === "Pending") return "Kitchen received your order...";
    if(s === "Preparing") return "Chef is cooking your meal... 🔥";
    if(s === "Ready") return "Your food is ready! ✅";
    return "Enjoy your meal!";
}

window.generateInvoice = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const order = window.activeOrder;
    doc.text(`Bill: ${restaurantData.name}`, 10, 10);
    doc.text(`Table: ${order.table}`, 10, 20);
    doc.text(`Total: ₹${order.total}`, 10, 30);
    doc.save("bill.pdf");
};

window.closeModal = () => document.getElementById('paymentModal').style.display = 'none';
window.filterMenu = () => loadMenu();

initApp();