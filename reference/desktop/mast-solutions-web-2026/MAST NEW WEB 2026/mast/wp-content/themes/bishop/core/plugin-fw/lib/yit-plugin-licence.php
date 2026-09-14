<?php
/**
 * This file belongs to the YIT Plugin Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

if ( ! class_exists( 'YIT_Plugin_Licence' ) ) {
    /**
     * YIT Plugin Licence Panel
     *
     * Setting Page to Manage Plugins
     *
     * @class      YIT_Plugin_Licence
     * @package    Yithemes
     * @since      1.0
     * @author     Andrea Grillo      <andrea.grillo@yithemes.com>
     */

    class YIT_Plugin_Licence extends YIT_Licence {

        /**
         * @var mixed array The registered plugins info
         * @since 1.0
         */
        protected $_plugins = array();

        /**
         * @var array The settings require to add the submenu page "Activation"
         * @since 1.0
         */
        protected $_settings = array();

        /**
         * @var object The single instance of the class
         * @since 1.0
         */
        protected static $_instance = null;

        /**
         * @var string Option name
         * @since 1.0
         */
        protected $_licence_option = 'yit_plugin_licence_activation';

        /**
         * @var string The yithemes api uri
         * @since 1.0
         */
        protected $_api_uri = 'http://www.yithemes.com';

        /**
         * @var string The yithemes api uri query args
         * @since 1.0
         */
        protected $_api_uri_query_args = '?wc-api=software-api&request=%request%';

        /**
         * Constructor
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function __construct() {

            $this->_settings = array(
                'parent_page' => 'yit_plugin_panel',
                'page_title'  => __( 'Licence Activation', 'yit' ),
                'menu_title'  => __( 'Licence Activation', 'yit' ),
                'capability'  => 'manage_options',
                'page'        => 'yith_plugins_activation',
            );

            add_action( 'admin_menu', array( $this, 'add_submenu_page' ), 99 );
            add_action( 'admin_enqueue_scripts', array( $this, 'localize_script' ), 15 );
            add_action( 'wp_ajax_activate', array( $this, 'activate' ) );
            add_action( 'wp_ajax_nopriv_activate', array( $this, 'activate' ) );
            add_action( 'wp_ajax_update_licence_information', array( $this, 'update_licence_information' ) );
            add_action( 'wp_ajax_nopriv_update_licence_information', array( $this, 'update_licence_information' ) );
        }

        /**
         * Localize Scripts
         *
         * @return void
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function localize_script() {
            wp_localize_script( 'yit-plugin-panel', 'licence_message', array(
                    'error'  => __( '%field% field can not be empty', 'yit' ),
                    'errors' => __( '%field_1% and %field_2% fields can not be empty', 'yit' ),
                    'server' => __( 'Unable to contact the remote server, please try again later. Thanks!', 'yit' )
                )
            );
        }

        /**
         * Activate Plugins
         *
         * Send a request to API server to activate plugins
         *
         * @return void
         * @use wp_send_json
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function activate() {

            $plugin_init = $_REQUEST['plugin_init'];
            $plugin      = $this->get_plugin( $plugin_init );

            $args = array(
                'email'       => sanitize_email( $_REQUEST['email'] ),
                'licence_key' => sanitize_text_field( $_REQUEST['licence_key'] ),
                'product_id'  => sanitize_text_field( $plugin['product_id'] ),
                'secret_key'  => sanitize_text_field( $plugin['secret_key'] ),
                'instance'    => $this->get_home_url()
            );

            $api_uri  = add_query_arg( $args, $this->get_api_uri( 'activation' ) );
            $response = wp_remote_get( $api_uri );

            if ( is_wp_error( $response ) ) {
                $body = false;
            }
            else {
                $body = json_decode( $response['body'] );
                $body = is_object( $body ) ? get_object_vars( $body ) : false;
            }

            if ( $body && is_array( $body ) && isset( $body['activated'] ) && $body['activated'] ) {

                $option[$plugin['product_id']] = array(
                    'email'                => $args['email'],
                    'licence_key'          => $args['licence_key'],
                    'licence_expires'      => $body['licence_expires'],
                    'message'              => $body['message'],
                    'activated'            => true,
                    'activation_limit'     => $body['activation_limit'],
                    'activation_remaining' => $body['activation_remaining'],
                );

                /* === Check for other plugins activation === */
                $options                        = $this->get_licence();
                $options[$plugin['product_id']] = $option[$plugin['product_id']];

                update_option( $this->_licence_option, $options );

                /* === Force Regenerate update_plugins Transient === */
                YIT_Upgrade()->force_regenerate_update_transient();

                /* === Licence Activation Template === */
                $body['template'] = $this->yith_plugins_activation();
            }

            wp_send_json( $body );
        }

        /**
         * Check Plugins Licence
         *
         * Send a request to API server to check if plugins is activated
         *
         * @param string|The plugin init slug $plugin_init
         *
         * @return bool | true if activated, false otherwise
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function check( $plugin_init ) {

            $status     = false;
            $body       = false;
            $plugin     = $this->get_plugin( $plugin_init );
            $licence    = $this->get_licence();
            $product_id = $plugin['product_id'];

            if( ! isset( $licence[ $product_id ] ) ) {
                return false;
            }

            $args = array(
                'email'       => $licence[$product_id]['email'],
                'licence_key' => $licence[$product_id]['licence_key'],
                'product_id'  => $product_id,
                'secret_key'  => $plugin['secret_key'],
                'instance'    => $this->get_home_url()
            );

            $api_uri  = add_query_arg( $args, $this->get_api_uri( 'check' ) );
            $response = wp_remote_get( $api_uri );

            if ( ! is_wp_error( $response ) ) {
                $body = json_decode( $response['body'] );
                $body = is_object( $body ) ? get_object_vars( $body ) : false;
            }

            if ( $body && is_array( $body ) && isset( $body['success'] ) ) {
                if ( $body['success'] ) {

                    /**
                     * Code 200 -> Licence key is valid
                     */
                    $licence[ $product_id ]['status_code']          = '200';
                    $licence[ $product_id ]['activated']            = $body['activated'];
                    $licence[ $product_id ]['licence_expires']      = $body['licence_expires'];
                    $licence[ $product_id ]['activation_remaining'] = $body['activation_remaining'];
                    $licence[ $product_id ]['activation_limit']     = $body['activation_limit'];
                    $status                                         = (bool) $body['activated'];
                }
                elseif ( isset( $body['code'] ) ) {

                    switch ( $body['code'] ) {

                        /**
                         * Error Code List:
                         *
                         * 100 -> Invalid Request
                         * 101 -> Invalid licence key
                         * 102 -> Software has been deactive
                         * 103 -> Exceeded maximum number of activations
                         * 104 -> Invalid instance ID
                         * 105 -> Invalid security key
                         * 106 -> Licence key has expired
                         * 107 -> Licence key has be banned
                         *
                         * Only code 101, 106 and 107 have effect on DB
                         *
                         */

                        case '101':
                            unset( $licence[ $product_id ] );
                            break;

                        case '106':
                            $licence[ $product_id ]['activated']        = false;
                            $licence[ $product_id ]['message']          = $body['additional_info'];
                            $licence[ $product_id ]['status_code']      = $body['code'];
                            $licence[ $product_id ]['licence_expires']  = $body['licence_expires'];
                            break;

                        case '107':
                            $licence[ $product_id ]['activated']   = false;
                            $licence[ $product_id ]['message']     = $body['additional_info'];
                            $licence[ $product_id ]['status_code'] = $body['code'];
                            break;
                    }
                }

                /* === Update Plugin Licence Information === */
                update_option( $this->_licence_option, $licence );
            }
            return $status;
        }

         /**
         * Update Plugins Information
         *
         * Send a request to API server to check activate plugins and update the informations
         *
         * @return void
         * @use YIT_Plugin_Licence->check()
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function update_licence_information() {
            foreach ( $this->_plugins as $init => $info ) {
                $this->check( $init );
            }

            /* === Regenerate Update Plugins Transient === */
            YIT_Upgrade()->force_regenerate_update_transient();

            $response['template'] = $this->yith_plugins_activation();
            wp_send_json( $response );
        }

        /**
         * Main plugin Instance
         *
         * @static
         * @return object Main instance
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public static function instance() {
            if ( is_null( self::$_instance ) ) {
                self::$_instance = new self();
            }

            return self::$_instance;
        }

        /**
         * Add "Activation" submenu page under YIT Plugins
         *
         * @return void
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function add_submenu_page() {
            add_submenu_page(
                $this->_settings['parent_page'],
                $this->_settings['page_title'],
                $this->_settings['menu_title'],
                $this->_settings['capability'],
                $this->_settings['page'],
                array( $this, 'yith_plugins_activation' )
            );
        }

        /**
         * Include activation page template
         *
         * @return mixed void | string the contents of the output buffer and end output buffering.
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function yith_plugins_activation() {
            if ( $this->is_ajax() ) {
                ob_start();
                require_once( YIT_CORE_PLUGIN_TEMPLATE_PATH . '/panel/activation/activation-panel.php' );
                return ob_get_clean();
            }
            else {
                require_once( YIT_CORE_PLUGIN_TEMPLATE_PATH . '/panel/activation/activation-panel.php' );
            }
        }

        /**
         * Premium plugin registration
         *
         * @param $plugin_init | string | The plugin init file
         * @param $secret_key  | string | The product secret key
         * @param $product_id  | string | The plugin slug (product_id)
         *
         * @return void
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function register( $plugin_init, $secret_key, $product_id ) {
            if ( ! function_exists( 'get_plugins' ) ) {
                require_once ABSPATH . 'wp-admin/includes/plugin.php';
            }

            $plugins                             = get_plugins();
            $plugins[$plugin_init]['secret_key'] = $secret_key;
            $plugins[$plugin_init]['product_id'] = $product_id;
            $this->_plugins[$plugin_init]        = $plugins[$plugin_init];
        }

        /**
         * Get protected array plugins
         *
         * @return mixed array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_plugins() {
            return $this->_plugins;
        }

        /**
         * Get activated plugins
         *
         * @return array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_activated_plugins() {
            $activated_plugins = array();
            $licence           = $this->get_licence();

            if ( is_array( $licence ) ) {
                foreach ( $this->_plugins as $init => $info ) {
                    if ( in_array( $info['product_id'], array_keys( $licence ) ) && isset( $licence[$info['product_id']]['activated'] ) && $licence[$info['product_id']]['activated'] ) {
                        $plugin[$init]            = $this->_plugins[$init];
                        $plugin[$init]['licence'] = $licence[$info['product_id']];
                        $activated_plugins[$init] = $plugin[$init];
                    }
                }
            }

            return $activated_plugins;
        }

        /**
         * Get to active plugins
         *
         * @return array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_to_active_plugins() {
            return array_diff_key( $this->get_plugins(), $this->get_activated_plugins() );
        }

        /**
         * Get no active plugins
         *
         * @return array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_no_active_licence_key() {
            $unactive_plugins = $this->get_to_active_plugins();
            $licence          = $this->get_licence();
            $licence_key      = array();

            /**
             * Remove banned licence key
             */
            foreach ( $unactive_plugins as $init => $info ) {
                $product_id = $unactive_plugins[$init]['product_id'];
                if ( isset( $licence[$product_id]['activated'] ) && ! $licence[$product_id]['activated'] && isset( $licence[$product_id]['status_code'] ) ) {
                    $status_code = $licence[$product_id]['status_code'];

                    switch ( $status_code ) {
                        case '106':
                            $licence_key[$status_code][$init]            = $unactive_plugins[$init];
                            $licence_key[$status_code][$init]['licence'] = $licence[$product_id];
                            break;

                        case '107':
                            $licence_key[$status_code][$init]            = $unactive_plugins[$init];
                            $licence_key[$status_code][$init]['licence'] = $licence[$product_id];
                            break;
                    }
                }
            }
            return $licence_key;
        }

        /**
         * Get a specific plugin information
         *
         * @param $plugin_init | plugin init file
         *
         * @return mixed array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_plugin( $plugin_init ) {
            return isset( $this->_plugins[$plugin_init] ) ? $this->_plugins[$plugin_init] : false;
        }

         /**
         * Get plugin product id information
         *
         * @param $plugin_init | plugin init file
         *
         * @return mixed array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_plugin_product_id( $plugin_init ) {
            return isset( $this->_plugins[$plugin_init]['product_id'] ) ? $this->_plugins[$plugin_init]['product_id'] : false;
        }

        /**
         * Get Renewing uri
         *
         * @param $licence_key The licence key to renew
         *
         * @return mixed The renewing uri if licence_key exists, false otherwise
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_renewing_uri( $licence_key ) {
            return ! empty( $licence_key ) ? $this->_api_uri . '?renewing_key=' . $licence_key : false;
        }

        /**
         * Get protected yithemes api uri
         *
         * @param   $request
         *
         * @return mixed array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_api_uri( $request ) {
            return str_replace( '%request%', $request, $this->_api_uri . $this->_api_uri_query_args );
        }

        /**
         * Get the activation page url
         *
         * @return String | Activation page url
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_licence_activation_page_url() {
            return add_query_arg( array( 'page' => $this->_settings['page'] ), admin_url( 'admin.php' ) );
        }


        /**
         * Get the licence information
         *
         * @return array | licence array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_licence() {
            return get_option( $this->_licence_option );
        }

        /**
         * Get the licence information
         *
         * @param $code string The error code
         *
         * @return string | Error code message
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_error_code_message( $code ) {

            $error_strings = array(
                '100' => __( 'Invalid Request', 'yit' ),
                '101' => __( 'Invalid licence key', 'yit' ),
                '102' => __( 'Software has been deactive', 'yit' ),
                '103' => __( 'Exceeded maximum number of activations', 'yit' ),
                '104' => __( 'Invalid instance ID', 'yit' ),
                '105' => __( 'Invalid security key', 'yit' ),
                '106' => __( 'Licence key has expired', 'yit' ),
                '107' => __( 'Licence key has be banned', 'yit' )
            );

            return isset( $error_strings[$code] ) ? $error_strings[$code] : false;
        }
    }
}

/**
 * Main instance of plugin
 *
 * @return object
 * @since  1.0
 * @author Andrea Grillo <andrea.grillo@yithemes.com>
 */
if( ! function_exists( 'YIT_Plugin_Licence' ) ){
    function YIT_Plugin_Licence() {
        return YIT_Plugin_Licence::instance();
    }
}