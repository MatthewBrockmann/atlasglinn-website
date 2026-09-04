<?php
/**
 * Plugin Name: YITH WooCommerce Colors and Labels Variations
 * Plugin URI: http://yithemes.com/
 * Description: YITH WooCommerce Ajax Colors and Labels Variations replaces the dropdown select of your variable products with Colors and Labels
 * Version: 1.1.2
 * Author: Your Inspiration Themes
 * Author URI: http://yithemes.com/
 * Text Domain: yit
 * Domain Path: /languages/
 *
 * @author Your Inspiration Themes
 * @package YITH WooCommerce Colors and Labels Variations
 * @version 1.1.0
 */
/*  Copyright 2013  Your Inspiration Themes  (email : plugins@yithemes.com)

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License, version 2, as
    published by the Free Software Foundation.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
*/
if ( !defined( 'ABSPATH' ) ) { exit; } // Exit if accessed directly

/**
 * Required functions
 */
if( !defined('YITH_FUNCTIONS') ) {
    require_once( 'yit-common/yit-functions.php' );
}

function yith_wccl_constructor() {
    global $woocommerce;
    if ( ! isset( $woocommerce ) ) return;

    load_plugin_textdomain( 'yit', false, dirname( plugin_basename( __FILE__ ) ). '/languages/' );

    define( 'YITH_WCCL', true );
    define( 'YITH_WCCL_URL', plugin_dir_url( __FILE__ ) );
    define( 'YITH_WCCL_DIR', plugin_dir_path( __FILE__ ) );
    define( 'YITH_WCCL_VERSION', '1.1.2' );

    // Load required classes and functions
    require_once('functions.yith-wccl.php');
    require_once('class.yith-wccl-admin.php');
    require_once('class.yith-wccl-frontend.php');
    require_once('class.yith-wccl.php');

    // Let's start the game!
    global $yith_wccl;
    $yith_wccl = new YITH_WCCL();
}
add_action( 'plugins_loaded', 'yith_wccl_constructor' );
