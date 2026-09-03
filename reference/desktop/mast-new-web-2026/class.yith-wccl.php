<?php
/**
 * Main class
 *
 * @author Your Inspiration Themes
 * @package YITH WooCommerce Colors and Labels Variations
 * @version 1.1.1
 */

if ( !defined( 'YITH_WCCL' ) ) { exit; } // Exit if accessed directly

if( !class_exists( 'YITH_WCCL' ) ) {
    /**
     * YITH WooCommerce Ajax Navigation
     *
     * @since 1.0.0
     */
    class YITH_WCCL {

        /**
         * Plugin object
         *
         * @var string
         * @since 1.0.0
         */
        public $obj = null;

        /**
         * Constructor
         *
         * @return mixed|YITH_WCCL_Admin|YITH_WCCL_Frontend
         * @since 1.0.0
         */
        public function __construct() {

            // actions
            add_action( 'init', array( $this, 'init' ) );


            if( is_admin() ) {
                $this->obj = new YITH_WCCL_Admin( YITH_WCCL_VERSION );
            }  else {
                $this->obj = new YITH_WCCL_Frontend( YITH_WCCL_VERSION );
            }
        }


        /**
         * Init method
         *
         * @access public
         * @since 1.0.0
         */
        public function init() {}

    }
}