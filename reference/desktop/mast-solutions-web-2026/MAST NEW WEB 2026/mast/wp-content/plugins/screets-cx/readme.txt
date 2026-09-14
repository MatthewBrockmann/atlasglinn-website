=== Screets Chat X ===
Tags: chat, live chat, helpdesk
Requires at least: 3.4
Tested up to: 3.9.1
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html

CX is a powerful chat plugin that adds chat features to your WordPress website. 
You can easily chat with your customers for sales and support.

== Installation ==

1. Upload `screets-cx` directory to the `/wp-content/plugins/` directory
1. Activate the plugin through the 'Plugins' menu in WordPress

== Changelog ==

Full change log of Screets Chat X. We always try to keep our products up-to-date and secure.

	Legend:

	[+] - new feature/improvement
	[*] - functionality changes
	[!] - bugfix

	Version 1.3.2 - 30 August 2014
		[!] Fixed wrong curl error message while activating the plugin
		[!] Fixed to icluding FirebaseLib again on settings page

	Version 1.3.1 - 27 August 2014
		[*] Updates improved
		[!] Fixed wrong display options on categories and 404 pages

	Version 1.3 - 24 August 2014
		[+] Added "email notifications" for operators when visitor logs into chat
		[+] Added visitor's active page url into chat console
		[+] All realtime data can be cleaned and stored to your own database in chat options
		[+] Added Russian language (Elena Prokofieva)
		[+] Added Portuguese/Brazilian language (Leonardo Fontoura)
		[+] Added security rules for Firebase
		[+] Added minimize arrow icon into popup header
		[+] Added default avatar
		[+] Realtime displaying chat button (delay is optional)
		[+] Keep button minimized after refreshing page
		[+] Now there is only one button status (no difference btw online/offline status)
		[*] Now CX uses PHP sessions by default if possible. Otherwise continue to use WP Sessions in database with a new "Clean Sessions" button in chat options
		[*] Normal visitor doesn't connect Firebase to prevent unnecessary connections
		[*] After clicking "End Chat" button, popup minimized instead of showing offline or login form in front-end
		[*] Now chat logs shows 50 items per page
		[*] "Hide when all operators offline" feature removed not to require every web visitor to connect Firebase
		[*] Improved "http_build_query" function for activating the plugin
		[*] Don't listen cmd (mac), ctrl, tab, shift, backspace and alt keys when user writing. It is good when user just surfing around tabs instead of really writing
		[*] Plugin activating shows cURL errors
		[*] Badge removed for better implementation
		[*] Now loads Firebase.js from your own server, not from Firebase CDN
		[*] Icon fonts embedded into CSS
		[*] Firebase.js updated to 1.0.19
		[*] Autosize plugin updated to 1.18.9
		[!] Fixed displaying options for categories and all other types
		[!] Fixed wrong mode displayed when login form disabled! Now showing contact form if all operators offline, not conversation
		[!] Fixed quoting slashes in chat options (added addslashes functions in fn.common.php)
		[!] Fixed disappearing popup after a couple of clicks when no animation selected
		[!] Fixed text link pattern in messages. Now supports full links like http://www.screets.com
		[!] Fixed "End Chat" issue. Now visitor removing from users list in chat console and when operator ends a visitor chat, visitor goes offline immediately 
		[!] Fixed bulk deleting in chat logs
		[!] Fixed wrong online mode when all operators offline and login form disabled. Now users who logged in before sees contact form even login form disabled.
	
	Version 1.2 - 13 June 2014
		[+] Added "User is typing..." notification
		[+] Now login form sent when user click "Enter" instead of clicking "Send" button
		[!] Fixed empty chat settings
		[!] Fixed reconnecting
		[!] Fixed chat logs order
		[!] Stripped slashed from chat logs messages
		
	Version 1.1.4 - 10 June 2014
		[*] Improved activating CX
		[*] Unnecessary browser logs removed
		[!] Fixed undefined index notices during post/page saving on backend
		
	Version 1.1.3 - 8 June 2014
		[*] Notifications in chat settings improved for admin users
		[*] Upgrading improved
		[!] Chat logs timestamp is fixed
		[!] Chat logs can be deleted now
		[!] Fixed "Always display homepage" issue
		[!] Fixed redirecting issue on offline button
	
	Version 1.1.2 - 7 June 2014
		(We had to skip this update because of wrong upload on our servers for auto-upgrading)

	Version 1.1.1 - 3 June 2014
		[*] Visitor's popup auto-opened when operator write new message!
		[!] Allow guests users when there is no login form
		[!] Fixed disappeared chat box issue when "Hide when all operators offline" is checked
		[!] Fixed display options on all post types and pages
		[!] Fixed desktop notification issue on Chrome browser
		[!] Fixed same IP and email problem for all visitors on chat console

	Version 1.1 - 29 May 2014
		[+] Now chat is realtime (Firebase integration)
		[+] Source code is optimized
		[+] Performance improved
		[+] More control added on appearance
		[*] AJAX removed from chat transmissions

	Version 1.0.1 - 23 Jan 2014
		[!] Fixed disconnecting issue

	Version 1.0 (not released yet)
		Launch  :)