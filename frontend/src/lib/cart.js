const KEY = "agri_cart";

export function getCart() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cart = JSON.parse(raw);
    if (!Array.isArray(cart.items)) return null;
    const items = cart.items.map((item) => ({
      ...item,
      vendor_user_id: item.vendor_user_id || cart.vendor_user_id,
      vendor_name: item.vendor_name || cart.vendor_name || "Vendor",
    }));
    return { items };
  } catch {
    return null;
  }
}

export function setCart(cart) {
  if (!cart?.items?.length) {
    clearCart();
    return;
  }
  const items = cart.items;
  localStorage.setItem(KEY, JSON.stringify({ items }));
  window.dispatchEvent(new Event("agri-cart-updated"));
}

export function clearCart() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("agri-cart-updated"));
}

export function addToCart(product, quantity = 1) {
  const cart = getCart();
  const next = cart || { items: [] };
  const existing = next.items.find((i) => i.product_id === product.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    next.items.push({
      product_id: product.id,
      name: product.name,
      unit: product.unit,
      price: Number(product.price || 0),
      quantity,
      vendor_user_id: product.vendor_user_id,
      vendor_name: product.vendor_name || "Vendor",
    });
  }
  setCart(next);
  return { ok: true };
}