// admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
    getFirestore, connectFirestoreEmulator,
    collection, query, where, orderBy, onSnapshot,
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
    getAuth, connectAuthEmulator, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/* --- Init + (conditional) Emulators --- */
const app = initializeApp(window.FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    connectFirestoreEmulator(db, "localhost", 8080);
    connectAuthEmulator(auth, "http://localhost:9099");
    console.log("[admin] Connected to emulators (Firestore @8080, Auth @9099)");
}

/* --- DOM refs --- */
const bodyMain = document.getElementById("queueBodyMain");
const emptyMain = document.getElementById("emptyMain");
const bodyReturn = document.getElementById("queueBodyReturn");
const emptyReturn = document.getElementById("emptyReturn");
const returnList = document.getElementById("returnList");

/* --- helpers --- */
const fmt = (ts) => {
    if (!ts) return "";
    const d = ts instanceof Timestamp ? ts.toDate() : ts;
    return new Intl.DateTimeFormat(undefined, {
        month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(d);
};

const btn = (label, action, id) =>
    `<button data-action="${action}" data-id="${id}" class="btn-sm">${label}</button>`;

/* --- Admin detection --- */
async function isAdminEmail(email) {
    if (!email) return false;
    const snap = await getDoc(doc(db, "adminEmails", email.toLowerCase()));
    return snap.exists();
}

/* --- Live listeners (switchable) --- */
let unsubWaiting = null;
let unsubReturn = null;

function attachListeners(baseCollection, isAdmin) {
    // clean up any old listeners
    unsubWaiting?.(); unsubReturn?.();

    const qWaiting = query(
        collection(db, baseCollection),
        where("status", "==", "waiting"),
        orderBy("createdAt", "asc")
    );

    const qReturn = query(
        collection(db, baseCollection),
        where("status", "==", "return"),
        // 'createdAt' is a stable sort even if 'returnAt' is missing in public mirror
        orderBy("createdAt", "asc")
    );

    unsubWaiting = onSnapshot(qWaiting, (snap) => {
        bodyMain.innerHTML = "";
        emptyMain.style.display = snap.empty ? "block" : "none";

        snap.forEach((row) => {
            const d = row.data();

            const cols = isAdmin
                ? `
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${d.name ?? ""}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${d.notify ?? ""}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${d.phone ?? ""}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${d.email ?? ""}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${fmt(d.createdAt)}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">
            ${btn("Serve", "serve", row.id)}
            ${btn("No-show", "return", row.id)}
            ${btn("Remove", "remove", row.id)}
          </td>
        `
                : `
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${d.name ?? ""}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)"></td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)"></td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)"></td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)">${fmt(d.createdAt)}</td>
          <td style="padding:8px; border-top:1px solid rgba(0,0,0,.08)"></td>
        `;

            const tr = document.createElement("tr");
            tr.innerHTML = cols;
            bodyMain.appendChild(tr);
        });
    }, (err) => console.error("Main queue error:", err));

    unsubReturn = onSnapshot(qReturn, (snap) => {
        returnList.innerHTML = "";
        emptyReturn.style.display = snap.empty ? "block" : "none";

        snap.forEach((row) => {
            const d = row.data();

            const li = document.createElement("li");
            if (isAdmin) {
                li.innerHTML = `
          <span class="name">${d.name ?? ""}</span>
          <div style="display:flex; gap:6px;">
            ${btn("Serve", "serve", row.id).replace('btn-sm', 'btn-sm return-btn')}
            ${btn("Remove", "remove", row.id).replace('btn-sm', 'btn-sm return-btn')}
          </div>
        `;
            } else {
                li.innerHTML = `<span class="name">${d.name ?? ""}</span>`;
            }
            returnList.appendChild(li);
        });
    }, (err) => console.error("Return queue error:", err));
}

/* --- Gate listeners by role --- */
onAuthStateChanged(auth, async (u) => {
    const admin = await isAdminEmail(u?.email);
    const base = admin ? "queue_entries" : "queue_public";
    attachListeners(base, admin);
});

/* --- Actions (admin only) --- */
document.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    const id = t.getAttribute("data-id");
    if (!action || !id) return;

    // Only allow actions for admins
    const user = auth.currentUser;
    const admin = await isAdminEmail(user?.email);
    if (!admin) return; // silently ignore clicks for viewers

    try {
        if (action === "serve") {
            // Private collection (source of truth)
            await updateDoc(doc(db, "queue_entries", id), {
                status: "served",
                servedAt: serverTimestamp()
            });
            // Public mirror update
            await updateDoc(doc(db, "queue_public", id), {
                status: "served",
                servedAt: serverTimestamp()
            }).catch(async () => {
                // If mirror missing, create it
                await setDoc(doc(db, "queue_public", id), {
                    name: "", status: "served", servedAt: serverTimestamp(), createdAt: serverTimestamp()
                });
            });

        } else if (action === "return") {
            await updateDoc(doc(db, "queue_entries", id), {
                status: "return",
                returnAt: serverTimestamp()
            });
            await updateDoc(doc(db, "queue_public", id), {
                status: "return",
                returnAt: serverTimestamp()
            }).catch(async () => {
                await setDoc(doc(db, "queue_public", id), {
                    name: "", status: "return", returnAt: serverTimestamp(), createdAt: serverTimestamp()
                });
            });

        } else if (action === "remove") {
            await deleteDoc(doc(db, "queue_entries", id));
            await deleteDoc(doc(db, "queue_public", id)).catch(() => { });
        }
    } catch (err) {
        console.error("Admin action failed:", err);
        alert(`Action failed: ${err?.code || ""} ${err?.message || err}`);
    }
});