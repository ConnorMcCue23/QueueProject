console.log("[queue] app.js loaded");

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  query,
  where,
  orderBy,
  getDocs,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const db  = getFirestore(app);

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") 
{
  connectFirestoreEmulator(db, "localhost", 8080);
  console.log("[queue] Firestore: connected to EMULATOR @ localhost:8080");
}

/* Form wiring */
const form = document.getElementById("joinForm");
const msg  = document.getElementById("msg");
const err  = document.getElementById("err");

function showOk(text) {
  msg.className = "note ok";
  msg.textContent = text;
  err.className = "alert";
  err.textContent = "";
}
function showErr(text) {
  err.className = "alert err";
  err.textContent = text;
  msg.className = "note";
  msg.textContent = "";
}

/** Compute the user's 1-based position in the waiting queue by ID.
 *  Retries briefly to allow serverTimestamp() to materialize. */
async function getPositionById(docId, { attempts = 5, delayMs = 300 } = {})
{
  for (let i = 0; i < attempts; i++) 
    {
      const q = query(collection(db, "queue_entries"), where("status", "==", "waiting"), orderBy("createdAt", "asc"));
      const snap = await getDocs(q);
      const idx = snap.docs.findIndex(d => d.id === docId);
      if (idx !== -1)
      {
        return idx + 1;
      }
      
    // wait a bit and retry (createdAt may not be set yet)
    await new Promise(res => setTimeout(res, delayMs));
  }
  return null; // not found after retries
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data    = Object.fromEntries(new FormData(form).entries());
  const name    = (data.name || "").trim();
  const phone   = (data.phone || "").trim();
  const email   = (data.email || "").trim().toLowerCase();
  const checkin = (data.checkin || "").trim(); // NEW

  // existing validation
  if (!name) 
  {
    return showErr("Please enter your name.");
  }

if (!email) 
{
  return showErr("Please enter an email so we can contact you.");
}

if (!checkin) 
{
  return showErr("Please enter the event code (ask staff).");
}

  // NEW: fetch currentJoinCode from Firestore and verify the attendee is physically checked in
  try {
    const settingsRef = doc(db, "settings", "event");
    const settingsSnap = await getDoc(settingsRef);
    const liveCode = settingsSnap.exists() ? settingsSnap.data().currentJoinCode : null;

    if (!liveCode || checkin !== liveCode) {
      return showErr("Invalid code. Please ask staff for the current event code.");
    }
  } catch (errFetch) {
    console.error("[queue] failed to verify code:", errFetch);
    return showErr("We're having trouble verifying the code. Please ask staff.");
  }

  // If we got here: code is valid, continue with your existing logic
  try {
    // 1. Write full private record
    const docRef = await addDoc(collection(db, "queue_entries"), {
      name,
      phone: phone || null,
      email: email || null,
      status: "waiting",
      createdAt: serverTimestamp()
    });

    // 2. Mirror the safe public record
    await setDoc(doc(db, "queue_public", docRef.id), {
      name,
      status: "waiting",
      createdAt: serverTimestamp()
    });

    form.reset();

    // 3. Compute initial position (your existing helper)
    const pos = await getPositionById(docRef.id);
    if (pos != null) {
      if (pos % 10 == 1) {
        showOk(`You're in! Your position: ${pos}st`);
      } else if (pos % 10 == 2) {
        showOk(`You're in! Your position: ${pos}nd`);
      } else if (pos % 10 == 3) {
        showOk(`You're in! Your position: ${pos}rd`);
      } else {
        showOk(`You're in! Your position: ${pos}th`);
      }
    } else {
      showOk("You're in! Your position will update shortly.");
    }
  } catch (e2) {
    console.error("[queue] write failed:", e2);
    showErr("Could not join the queue. Please try again.");
  }
});