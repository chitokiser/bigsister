import { auth, State } from './utils.js';
import { connectWallet, getTier } from './auth-wallet.js';
import { renderRoute, refreshHome, refreshMy, refreshAgentState, renderAgentPipes, renderAdmin } from './features.js';

// Re-add the auth.onAuthStateChanged listener, now calling the imported functions
auth.onAuthStateChanged(async (u)=>{
  State.user = u || null;
  document.getElementById("btn-google")?.classList.toggle("hidden", !!u);
  document.getElementById("btn-logout")?.classList.toggle("hidden", !u);
  document.getElementById("user-photo")?.classList.toggle("hidden", !u);
  if(u?.photoURL){ document.getElementById("user-photo").src = u.photoURL; }

  await refreshAgentState();
  if(location.hash === "" || location.hash === "#/"){ renderRoute("home"); } // Call renderRoute with "home"
  refreshHome();
  refreshMy();
  if(location.hash.replace("#/", "")==="agent") renderAgentPipes();
  if(location.hash.replace("#/", "")==="admin") renderAdmin();
});

// Initial render
renderRoute();