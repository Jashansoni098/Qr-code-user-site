import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc, updateDoc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = [];
let total = 0;
let restaurantData = {};
let userUID = localStorage.getItem('platto_uid') || "user_" + Math.floor(Math.random() * 1000000);
localStorage.setItem('platto_uid', userUID);

// Initialize App
async function init() {
    if(!resId) {
        document.body.innerHTML = "<h1 style='text-align:center; padding:50px;'>Invalid QR ❌</h1>";
        return;
    }

    // 1. Fetch Restaurant Settings (Feature 5, 8, 9)
    const resRef = doc(db, "restaurants", resId);
    const resSnap = await getDoc(resRef);
    if(resSnap.exists()) {
        restaurantData = resSnap.data();
        document.getElementById('res-name-display').innerText = restaurantData.name;
        document.getElementById('wait-time-badge').innerText = `⏳ Average Wait: ${restaurantData.prepTime || '20'} Mins`;
        document.getElementById('res-about-text').innerText = restaurantData.about || "Welcome to our digital menu experience.";
        document.getElementById('table-badge').innerText = `Table ${tableNo}`;
        if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
        
        // WhatsApp Link (Feature 8)
        document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
    }

    // 2. Fetch User Loyalty Points (Feature 3)
    fetchLoyalty();

    // 3. Menu Real-time + Filtering (Feature 2)
    loadMenu();

    // 4. Live Tracking Check (Feature 1 & 10)
    checkLiveOrder();
}

// Feature 3: Loyalty Logic
async function fetchLoyalty() {
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
}

// Feature 2: Menu Categorization
function loadMenu() {
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const container = document.getElementById('menu-container');
        container.innerHTML = "";
        
        const isVegOnly = document.getElementById('veg-toggle').checked;
        
        snapshot.forEach(d => {
            const item = d.data();
            // Filter logic (Simple check: if name contains 'veg' or custom field)
            if(isVegOnly && !item.name.toLowerCase().includes('veg')) return;

            container.innerHTML += `
                <div class="food-card">
                    <div class="food-details">
                        <h4>${item.name}</h4>
                        <div class="price-tag">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD +</button>
                </div>
            `;
        });
        document.getElementById('loader').style.display = 'none';
    });
}

window.addToCart = (name, price) => {
    cart.push({name, price});
    total += parseInt(price);
    document.getElementById('cart-bar').style.display = 'flex';
    document.getElementById('cart-qty').innerText = `${cart.length} Items`;
    document.getElementById('cart-total').innerText = `₹${total}`;
};

// Feature 4: UPI Deep Linking
window.payViaUPI = () => {
    if(!restaurantData.upiId) return alert("Online payment not set by restaurant.");
    
    let finalAmt = total;
    const pts = parseInt(document.getElementById('user-pts').innerText);
    if(pts >= 1000) finalAmt -= 10; // Auto-discount logic

    const upiUrl = `upi://pay?pa=${restaurantData.upiId}&pn=${restaurantData.name}&am=${finalAmt}&cu=INR`;
    window.location.href = upiUrl;
};

// Feature 1 & 10: Live Tracking (Session Management)
function checkLiveOrder() {
    const q = query(collection(db, "orders"), 
              where("resId", "==", resId), 
              where("table", "==", tableNo),
              where("status", "!=", "Done"));

    onSnapshot(q, (snapshot) => {
        if(!snapshot.empty) {
            const order = snapshot.docs[0].data();
            const banner = document.getElementById('tracking-banner');
            banner.style.display = 'flex';
            
            document.getElementById('track-status-text').innerText = getStatusMsg(order.status);
            
            // Feature 7: Show Bill button if Ready/Picked Up
            if(order.status === "Ready" || order.status === "Picked Up") {
                document.getElementById('download-bill-btn').style.display = 'block';
                window.currentOrderForBill = order;
            }
        }
    });
}

function getStatusMsg(s) {
    if(s === "Pending") return "Order Received! Awaiting Chef...";
    if(s === "Preparing") return "Chef is cooking your meal... 🔥";
    if(s === "Ready") return "Food is Ready! Please collect. ✅";
    if(s === "Picked Up") return "Enjoy your meal! 😋";
    return "Status Update...";
}

// Feature 6 & 7: Order & Loyalty Earning
window.confirmOrder = async () => {
    const note = document.getElementById('chef-instruction').value;
    const orderData = {
        resId, table: tableNo, items: cart, total, 
        status: "Pending", timestamp: new Date(), 
        instruction: note, userUID
    };

    const docRef = await addDoc(collection(db, "orders"), orderData);
    
    // Earn Points: ₹100 = 10 Points
    const earned = Math.floor(total / 100) * 10;
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let currentPts = userSnap.exists() ? userSnap.data().points : 0;
    
    // Redeem if pts > 1000 (Already applied in UI total)
    if(currentPts >= 1000) currentPts -= 1000;

    await setDoc(userRef, { points: currentPts + earned }, { merge: true });

    alert("Order Sent to Kitchen!");
    location.reload();
};

// Feature 7: Digital Invoice (jspdf)
window.generateInvoice = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const order = window.currentOrderForBill;

    doc.setFontSize(22);
    doc.text(restaurantData.name, 20, 20);
    doc.setFontSize(12);
    doc.text(`Invoice for Table ${order.table}`, 20, 30);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 40);
    doc.line(20, 45, 190, 45);

    let y = 55;
    order.items.forEach(i => {
        doc.text(`- ${i.name}`, 20, y);
        doc.text(`₹${i.price}`, 170, y);
        y += 10;
    });

    doc.line(20, y, 190, y);
    doc.text(`TOTAL AMOUNT: ₹${order.total}`, 20, y + 10);
    doc.text(`Earned Loyalty Points: ${Math.floor(order.total/100)*10}`, 20, y + 20);
    
    doc.save("Platto_Invoice.pdf");
};

window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = 'flex';
    document.getElementById('final-amt').innerText = `₹${total}`;
    const pts = parseInt(document.getElementById('user-pts').innerText);
    if(pts >= 1000) document.getElementById('loyalty-discount-msg').style.display = 'block';
};
window.closeModal = () => document.getElementById('paymentModal').style.display = 'none';
window.filterMenu = () => loadMenu();

init();