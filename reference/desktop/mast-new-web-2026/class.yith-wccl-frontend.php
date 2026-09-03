<?php
/**
 * Frontend class
 *
 * @author Your Inspiration Themes
 * @package YITH WooCommerce Colors and Labels Variations
 * @version 1.1.0
 */

if ( !defined( 'YITH_WCCL' ) ) { exit; } // Exit if accessed directly

if( !class_exists( 'YITH_WCCL_Frontend' ) ) {
    /**
     * Frontend class.
     * Manage all the frontend behaviors.
     *
     * @since 1.0.0
     */
    class YITH_WCCL_Frontend {
        /**
         * Plugin version
         *
         * @var string
         * @since 1.0.0
         */
        public $version;

        /**
         * Constructor
         *
         * @access public
         * @since 1.0.0
         */
        public function __construct( $version ) {
            $this->version = $version;

            //Actions
            add_action( 'init', array( $this, 'init' ) );
            add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_static' ) );

            //Override default WooCommerce add-to-cart/variable.php template
            add_action( 'template_redirect', array( $this, 'override' ) );

            // YITH WCCL Loaded
            do_action( 'yith_wccl_loaded' );
        }


        /**
         * Init method
         *
         * @access public
         * @since 1.0.0
         */
        public function init() {}


        /**
         * Override default template
         *
         * @access public
         * @since 1.0.0
         */
        public function override() {
            remove_action( 'woocommerce_variable_add_to_cart', 'woocommerce_variable_add_to_cart', 30 );
            add_action( 'woocommerce_variable_add_to_cart', array( $this, 'variable_add_to_cart' ), 30 );
        }


        /**
         * Output the variable product add to cart area.
         *
         * @access public
         * @since 1.0.0
         */
        function variable_add_to_cart() {
            global $product;

            // Enqueue variation scripts
            wp_enqueue_script( 'wc-add-to-cart-variation' );

            $attributes = $product->get_variation_attributes();

            /** FIX WOO 2.1 */
            $wc_get_template = function_exists('wc_get_template') ? 'wc_get_template' : 'woocommerce_get_template';

            // Load the template
            $wc_get_template( 'single-product/add-to-cart/variable-wccl.php', array(
                'available_variations'  => $product->get_available_variations(),
                'attributes'   			=> $attributes,
                'selected_attributes' 	=> $product->get_variation_default_attributes(),
                'attributes_types'      => $this->get_variation_attributes_types( $attributes )
            ), '', YITH_WCCL_DIR . 'templates/' );
        }


        /**
         * Get an array of types and values for each attribute
         *
         * @access public
         * @since 1.0.0
         */
        public function get_variation_attributes_types( $attributes ) {
            global $wpdb;
            $types = array();

            if( !empty($attributes) ) {
                foreach( $attributes as $name => $options ) {
                    $attribute_name = substr($name, 3);
                    $attribute = $wpdb->get_row("SELECT * FROM " . $wpdb->prefix . "woocommerce_attribute_taxonomies WHERE attribute_name = '$attribute_name'");
                    $types[$name] = $attribute->attribute_type;
                }

            }

            return $types;
        }


        /**
         * Enqueue frontend styles and scripts
         *
         * @access public
         * @return void
         * @since 1.0.0
         */
        public function enqueue_static() {
            global $post;

            $suffix = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';

			$css = file_exists( get_stylesheet_directory() . '/woocommerce/yith_wccl.css' ) ? get_stylesheet_directory_uri() . '/woocommerce/yith_magnifier.css' : YITH_WCCL_URL . 'assets/css/frontend.css';

			wp_register_script( 'yith_wccl_frontend', YITH_WCCL_URL . 'assets/js/frontend'. $suffix .'.js', array('jquery', 'wc-add-to-cart-variation'), $this->version, true );
			wp_register_style( 'yith_wccl_frontend', $css, false, $this->version );

            if( is_product() || ( ! empty( $post->post_content ) && strstr( $post->post_content, '[product_page' ) ) ) {
                wp_enqueue_script( 'yith_wccl_frontend' );
                wp_enqueue_style( 'yith_wccl_frontend' );
            }
        }

    }
}
