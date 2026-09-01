/**
 * MAST Solutions — 3-click checkout.
 *
 * Click 1: "Enroll" / "Join" on a card  -> opens the sheet
 * Click 2: "Continue to Secure Checkout" -> creates a Stripe Checkout Session
 * Click 3: "Pay" on Stripe's hosted page
 *
 * Two modes, both handled by the same Cloudflare Worker:
 *   payment      -> POST {storeEndpoint} (one-time class seats)
 *   subscription -> POST {subEndpoint}   (recurring membership tiers)
 *
 * Config is injected from PHP via wp_localize_script as `window.MAST`.
 */
(function () {
	'use strict';

	if (typeof window.MAST === 'undefined') {
		return;
	}

	var cfg = window.MAST;
	var i18n = cfg.i18n || {};

	var sheet = document.getElementById('mast-sheet');
	var backdrop = document.getElementById('mast-sheet-backdrop');
	var banner = document.getElementById('mast-banner');

	if (!sheet || !backdrop) {
		return;
	}

	var titleEl = sheet.querySelector('#mast-sheet-title');
	var metaEl = sheet.querySelector('[data-mast-meta]');
	var unitEl = sheet.querySelector('[data-mast-unit]');
	var emailEl = sheet.querySelector('#mast-email');
	var nameEl = sheet.querySelector('#mast-name');
	var qtyWrap = sheet.querySelector('[data-mast-qty-wrap]');
	var qtyEl = sheet.querySelector('[data-mast-qty]');
	var totalEl = sheet.querySelector('[data-mast-total]');
	var totalLabel = sheet.querySelector('[data-mast-total-label]');
	var payBtn = sheet.querySelector('[data-mast-pay]');
	var errEl = sheet.querySelector('[data-mast-err]');

	var current = null;
	var qty = 1;
	var lastFocused = null;

	function money(cents) {
		var n = cents / 100;
		return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0 });
	}

	function showError(msg) {
		errEl.textContent = msg;
		errEl.classList.add('show');
	}

	function clearError() {
		errEl.classList.remove('show');
	}

	function updateTotal() {
		if (!current) {
			return;
		}
		var isSub = current.mode === 'subscription';
		totalEl.textContent = money(current.price * (isSub ? 1 : qty));
	}

	function openSheet(data) {
		current = data;
		qty = 1;
		lastFocused = document.activeElement;

		var isSub = data.mode === 'subscription';

		titleEl.textContent = data.name;
		metaEl.textContent = data.meta || '';
		unitEl.textContent = money(data.price) + (isSub ? '' : ' / seat');

		// Subscriptions are one seat per checkout; hide the seat stepper.
		qtyWrap.style.display = isSub ? 'none' : '';
		qtyEl.textContent = '1';
		totalLabel.textContent = isSub ? (data.meta || 'Recurring') : 'Total';

		clearError();
		updateTotal();

		backdrop.classList.add('open');
		sheet.classList.add('open');
		setTimeout(function () {
			emailEl.focus();
		}, 250);
	}

	function closeSheet() {
		backdrop.classList.remove('open');
		sheet.classList.remove('open');
		if (lastFocused && typeof lastFocused.focus === 'function') {
			lastFocused.focus();
		}
	}

	function stepQty(delta) {
		qty = Math.min(10, Math.max(1, qty + delta));
		qtyEl.textContent = String(qty);
		updateTotal();
	}

	function startCheckout() {
		var email = emailEl.value.trim();
		clearError();

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
			showError(i18n.badEmail || 'Enter a valid email address.');
			emailEl.focus();
			return;
		}

		var isSub = current.mode === 'subscription';
		var base = cfg.returnUrl || (location.origin + location.pathname);
		var joiner = base.indexOf('?') === -1 ? '?' : '&';
		var successUrl = base + joiner + 'checkout=success&item=' + encodeURIComponent(current.name);
		var cancelUrl = base + joiner + 'checkout=cancelled';

		var endpoint = isSub ? cfg.subEndpoint : cfg.storeEndpoint;
		var body = isSub
			? {
				email: email,
				plan: current.plan,
				seats: 1,
				successUrl: successUrl,
				cancelUrl: cancelUrl
			}
			: {
				// The SKU is the only product identity sent. The Worker looks up
				// the price server-side, so a tampered request cannot set its own
				// amount. `current.price` is display-only.
				sku: current.sku || '',
				qty: qty,
				customer_email: email,
				customer_name: nameEl.value.trim(),
				success_url: successUrl,
				cancel_url: cancelUrl
			};

		payBtn.disabled = true;
		payBtn.textContent = i18n.preparing || 'Preparing secure checkout…';

		fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok || !data.checkoutUrl) {
						throw new Error(data.error || 'Checkout unavailable');
					}
					return data;
				});
			})
			.then(function (data) {
				location.href = data.checkoutUrl;
			})
			.catch(function (e) {
				payBtn.disabled = false;
				payBtn.textContent = i18n.continue || 'Continue to Secure Checkout';
				showError(
					(i18n.failed || 'Could not start checkout') +
					' (' + e.message + '). ' +
					(cfg.phone ? 'Please try again or call ' + cfg.phone + '.' : 'Please try again.')
				);
			});
	}

	// ── Wire up buy buttons ──
	document.addEventListener('click', function (e) {
		var buy = e.target.closest('[data-mast-buy]');
		if (buy) {
			openSheet({
				mode: buy.dataset.mode || 'payment',
				name: buy.dataset.name,
				meta: buy.dataset.meta,
				price: parseInt(buy.dataset.price, 10) || 0,
				sku: buy.dataset.sku,
				plan: buy.dataset.plan
			});
			return;
		}

		if (e.target.closest('[data-mast-close]')) {
			closeSheet();
			return;
		}

		var step = e.target.closest('[data-mast-step]');
		if (step) {
			stepQty(parseInt(step.dataset.mastStep, 10));
			return;
		}

		if (e.target.closest('[data-mast-pay]')) {
			startCheckout();
		}
	});

	document.addEventListener('keydown', function (e) {
		if ('Escape' === e.key) {
			closeSheet();
		}
	});

	// ── Mobile menu ──
	var menuBtn = document.querySelector('[data-mast-menu]');
	var panel = document.getElementById('mobile-panel');
	if (menuBtn && panel) {
		menuBtn.addEventListener('click', function () {
			var open = panel.classList.toggle('open');
			menuBtn.setAttribute('aria-expanded', String(open));
		});
		panel.addEventListener('click', function (e) {
			if ('A' === e.target.tagName) {
				panel.classList.remove('open');
				menuBtn.setAttribute('aria-expanded', 'false');
			}
		});
	}

	// ── Return from Stripe ──
	(function () {
		if (!banner) {
			return;
		}
		var params = new URLSearchParams(location.search);
		var state = params.get('checkout');
		if (!state) {
			return;
		}

		if ('success' === state) {
			var item = params.get('item');
			banner.textContent = '✅ ' + (i18n.booked || "You're booked") +
				(item ? ' — ' + item : '') + '. ' + (i18n.receipt || '');
			banner.classList.add('ok');
		} else {
			banner.textContent = i18n.cancelled || 'Checkout cancelled — your card was not charged.';
		}

		banner.classList.add('show');
		setTimeout(function () {
			banner.classList.remove('show');
		}, 9000);

		history.replaceState(null, '', location.pathname);
	})();
})();
