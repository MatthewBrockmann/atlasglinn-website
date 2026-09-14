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

if ( ! class_exists( 'YIT_Licence' ) ) {
    /**
     * YIT Licence Panel
     *
     * Setting Page to Manage Products
     *
     * @class      YIT_Licence
     * @package    Yithemes
     * @since      1.0
     * @author     Andrea Grillo      <andrea.grillo@yithemes.com>
     */

    abstract class YIT_Licence {

        /**
         * @var mixed array The registered products info
         * @since 1.0
         */
        protected $_products = array();

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
        protected $_licence_option = 'yit_products_licence_activation';

        /**
         * @var string The yithemes api uri
         * @since 1.0
         */
        protected $_api_uri = '';

        /**
         * @var string The yithemes api uri query args
         * @since 1.0
         */
        protected $_api_uri_query_args = '?';

        /**
         * Constructor
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function __construct();

        /**
         * Premium products activation
         *
         * @return void
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function activate();

        /**
         * Premium products check licence
         *
         * @param $init string | The product identifier
         *
         * @return void
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function check( $init );

        /**
         * Premium products registration
         *
         * @param $init         string | The products identifier
         * @param $secret_key   string | The secret key
         * @param $product_id   string | The product id
         *
         * @return void
         *
         * @since    1.0
         * @author   Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function register( $init, $secret_key, $product_id );

        /**
         * Get the activation page url
         *
         * @return String | Activation page url
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function get_licence_activation_page_url();

        /**
         * Get the licence information
         *
         * @return String | Activation page url
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        abstract public function get_licence();

        /**
         * Get protected array products
         *
         * @return mixed array
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_products() {
            return $this->_products;
        }

        /**
         * Get The home url without protocol
         *
         * @return string | The home url
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function get_home_url() {
            return is_ssl() ? str_replace( 'https://', '', home_url() ) : str_replace( 'http://', '', home_url() );
        }

        /**
         * Check if the request is ajax
         *
         * @return bool true if the request is ajax, false otherwise
         *
         * @since  1.0
         * @author Andrea Grillo <andrea.grillo@yithemes.com>
         */
        public function is_ajax() {
            return defined( 'DOING_AJAX' ) && DOING_AJAX ? true : false;
        }
    }
}