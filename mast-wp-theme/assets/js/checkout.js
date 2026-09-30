/**
 * MAST Solutions — 3-click checkout.
 *
 * Click 1: "Enroll" / "Join" on a card  -> opens the sheet
 * Click 2: "Continue to Secure Checkout" -> creates a Stripe Checkout Session (memberships)
 * Click 3: "Pay" on Stripe's hosted page
 *
 * Memberships (subscription mode) -> POST {subEndpoint}.
 *
 * Classes are not checked out here. The Worker's /create-booking answers 410: it sold a live-fire
 * seat with no eligibility screening, no participation agreement and no seat-capacity claim, and
 * the MAST page's registration is the only flow that runs all three. A class with an upcoming day
 * in the schedule {weekendsEndpoint} publishes (not before today in Houston) links to
 * {bookUrl}?course=<SKU>#s6, which opens that course there; a class with no such day joins the
 * waiting list as a request_type 'waitlist' to {contactEndpoint}.
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
	var schedule = null;

	// Today in Houston as YYYY-MM-DD, the rule the MAST page and the Worker both use.
	function todayCT() {
		var p = {};
		new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
			.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
		return p.year + '-' + p.month + '-' + p.day;
	}

	// [[day, sku], ...] from the Worker, fetched once; [] when it cannot be read, which sends every class to the waiting list.
	function loadSchedule() {
		if (!schedule) {
			schedule = fetch(cfg.weekendsEndpoint)
				.then(function (res) { return res.ok ? res.json() : {}; })
				.then(function (d) { return Array.isArray(d.schedule) ? d.schedule : []; })
				.catch(function () { return []; });
		}
		return schedule;
	}

	function nextDay(rows, sku) {
		var today = todayCT();
		var days = rows.filter(function (r) { return r[1] === sku && r[0] >= today; }).map(function (r) { return r[0]; }).sort();
		return days.length ? days[0] : null;
	}

	// The MAST page opens a ?course= deep link exactly as a tap on that course's row would: gate, calendar, registration.
	function bookingUrl(sku) {
		return (cfg.bookUrl || 'https://www.mastsolutions.com/') + '?course=' + encodeURIComponent(sku) + '#s6';
	}

	function dayLabel(day) {
		var p = day.split('-');
		return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	}

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

		payBtn.textContent = i18n.continue || 'Continue to Secure Checkout';
		payBtn.disabled = false;
		if (!isSub) {
			// The label is decided by the same lookup that decides where the button goes, so the two cannot disagree.
			payBtn.disabled = true;
			loadSchedule().then(function (rows) {
				if (current !== data) {
					return;
				}
				data.day = nextDay(rows, data.sku);
				if (data.day) {
					metaEl.textContent = (data.meta ? data.meta + ' · ' : '') + dayLabel(data.day);
					payBtn.textContent = (i18n.book || 'Book on mastsolutions.com') + ' →';
					qtyWrap.style.display = 'none';   // seats are chosen on the MAST page
				} else {
					payBtn.textContent = i18n.waitlist || 'Join waiting list';
				}
				payBtn.disabled = false;
			});
		}

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
		var isSub = current.mode === 'subscription';
		clearError();

		if (!isSub && current.day) {
			location.href = bookingUrl(current.sku);
			return;
		}

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
			showError(i18n.badEmail || 'Enter a valid email address.');
			emailEl.focus();
			return;
		}

		if (!isSub) {
			joinWaitlist(email);
			return;
		}
		var base = cfg.returnUrl || (location.origin + location.pathname);
		var joiner = base.indexOf('?') === -1 ? '?' : '&';
		var successUrl = base + joiner + 'checkout=success&item=' + encodeURIComponent(current.name);
		var cancelUrl = base + joiner + 'checkout=cancelled';

		var endpoint = cfg.subEndpoint;
		var body = {
			email: email,
			plan: current.plan,
			seats: 1,
			successUrl: successUrl,
			cancelUrl: cancelUrl
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

	function joinWaitlist(email) {
		var name = nameEl.value.trim();
		if (name.length < 2) {
			showError(i18n.waitName || 'Enter your name to join the waiting list.');
			nameEl.focus();
			return;
		}
		var item = current.name;
		payBtn.disabled = true;
		fetch(cfg.contactEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				kind: 'contact',
				request_type: 'waitlist',
				name: name,
				email: email,
				message: 'Waiting list — ' + item + (qty > 1 ? '\nSeats: ' + qty : ''),
				page: location.href.split('#')[0]
			})
		})
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok) {
						throw new Error(data.error || 'Request failed');
					}
				});
			})
			.then(function () {
				closeSheet();
				if (banner) {
					banner.textContent = (i18n.waited || "You're on the waiting list — we email you as soon as dates are set.") + ' (' + item + ')';
					banner.classList.add('ok', 'show');
					setTimeout(function () { banner.classList.remove('show'); }, 9000);
				}
			})
			.catch(function (e) {
				payBtn.disabled = false;
				showError(e.message + (cfg.phone ? ' Please try again or call ' + cfg.phone + '.' : ''));
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
