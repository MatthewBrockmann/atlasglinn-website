<?php
/*
Plugin Name: YIT Backup&Reset
Plugin URI: http://www.yourinspirationweb.com
Description: YIT Framework plugin: Add Backup&Reset features
Author: YIThemes
Text Domain: yit
Domain Path: /languages/
Version: 1.0.1
Author URI: http://www.yithemes.com
*/


// Exit if accessed directly
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/* === DEFINE === */
define( 'YIT_BACKUP_RESET', true );
define( 'YIT_BACKUP_RESET_PATH', plugin_dir_path(__FILE__) );
define( 'YIT_BACKUP_RESET_THEME_PATH', YIT_BACKUP_RESET_PATH . 'theme' );
define( 'YIT_BACKUP_RESET_CONFIG_PATH', YIT_BACKUP_RESET_PATH . 'config' );
define( 'YIT_BACKUP_RESET_URL', plugin_dir_url(__FILE__) );

/* === ACTIONS === */
add_action( 'admin_init', 'yit_backup_reset_loader' );
add_action( 'plugins_loaded', 'yit_backup_reset_load_text_domain' );

/* === FILTERS === */
if( is_admin() ){
    add_filter( 'yit_panel_submenu_paths', 'yit_add_panel_template' );
    add_filter( 'yit_admin_menu_pages', 'yit_add_admin_menu_pages' );
    add_filter( 'yit_add_external_template_path', 'yit_add_plugin_template_path' );
    add_filter( 'yit_panel_template_paths', 'yit_panel_plugin_template_path' );
}

require_once 'Backup_reset.php';


/**
 * Load the plugin text domain for localization
 *
 * @return void
 * @since  1.0
 * @author Emanuela Castorina <emanuela.castorina@yithemes.com>
 */
function yit_backup_reset_load_text_domain(){
    load_plugin_textdomain( 'yit', false, dirname( plugin_basename( __FILE__ ) ). '/languages/' );
}

/**
 * Load the core of the plugin, added to "after_theme_setup" so you can load the core only if it isn't loaded by plugin
 *
 * @return void
 * @since  1.0
 * @author Antonino Scarfì <antonino.scarfi@yithemes.com>
 * @author Andrea Grillo   <andrea.grillo@yithemes.com>
 */
function yit_backup_reset_loader() {

    $headers['core']   = wp_get_theme()->get( 'Core Framework Version' );
    $headers['author'] = wp_get_theme()->get( 'Author' );

    $is_new_yith_fw = ( ( ! empty( $headers['core'] ) && version_compare( $headers['core'], '2.0.0', '<=' ) ) || $headers['author'] != 'Your Inspiration Themes' ) ? true : false;

    if( $is_new_yith_fw && is_admin() ) {
        YIT_Backup_Reset();
    }
}

function yit_add_panel_template( $path ){
    $plugin_path = array(
        YIT_BACKUP_RESET_PATH . 'core/yit/panel',
        YIT_BACKUP_RESET_PATH . 'theme/yit/panel'
    );

    return array_merge( $path, $plugin_path );
}

function yit_add_admin_menu_pages( $path ){

    $new_options_page = array( /* Sample Data */
            'sample-data' => array(
                'sample-data-and-image' => array(
                    'install-and-downloads',
                )
            ),

            /* Backup & Reset Tabs */
            'backup-and-reset' => array(
                'backup' => array(
                    'import-and-export-data',
                    'theme_options_backups'
                ),

                'reset' => array(
                    'reset-option'
                )
            ));

    return array_merge($path, $new_options_page);
}

function yit_add_plugin_template_path(){
    return YIT_BACKUP_RESET_PATH;
}

function yit_panel_plugin_template_path( $paths ){
    $paths[] = YIT_BACKUP_RESET_THEME_PATH;
    return $paths;
}

if ( ! function_exists( 'YIT_Backup_Reset' ) ) {
    /**
     * Return the instance of YIT_Panel class
     *
     * @return \YIT_Panel
     * @since    2.0.0
     * @author   Andrea Grillo <andrea.grillo@yithemes.com>
     */
    function YIT_Backup_Reset() {
        return new YIT_Backup_reset();
    }
}