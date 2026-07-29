export default function showToast(message, ms = 3500){
  if (!message) return;
  const id = 'global-toast';
  let el = document.getElementById(id);
  if (!el){
    el = document.createElement('div');
    el.id = id;
    el.className = 'toast';
    document.body.appendChild(el);
  }
  // reset timer if exists
  if (el._toastTimer){
    clearTimeout(el._toastTimer);
    el._toastTimer = null;
  }
  el.textContent = message;
  el.style.opacity = '1';
  // ensure visible
  el.style.display = 'block';
  el._toastTimer = setTimeout(()=>{
    try{ el.style.opacity = '0'; el.style.display = 'none'; }catch(e){}
    el._toastTimer = null;
  }, ms);
}
