import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. URL se Restaurant ID nikalna
// URL example: user.html?resId=APKA_DOC_ID&table=5
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "--";

const loader = document.getElementById('loader');

async function initUserApp() {
    if (!resId) {
        document.body.innerHTML = "<div style='padding:50px; text-align:center;'><h2>⚠️ Invalid QR Code</h2><p>Please scan a valid restaurant QR code.</p></div>";
        return;
    }

    document.getElementById('tableNumber').innerText = tableNo;

    try {
        // 2. Fetch Restaurant Data from Firestore
        const resRef = doc(db, "restaurants", resId);
        const resSnap = await getDoc(resRef);

        if (resSnap.exists()) {
            const data = resSnap.data();
            // Restaurant ka naam update karein
            document.getElementById('displayResName').innerText = data.name;
            document.title = "Platto | " + data.name;
            
            // Agar logo url hai toh change karein
            if(data.logoUrl) document.getElementById('resLogo').src = data.logoUrl;

            console.log("Restaurant Loaded:", data.name);
        } else {
            alert("Restaurant not found in our system!");
        }
    } catch (error) {
        console.error("Error fetching restaurant:", error);
    } finally {
        loader.style.display = 'none';
    }
}

// Start app
initUserApp();