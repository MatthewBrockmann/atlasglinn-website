<?php
/**
 * This file belongs to the YIT Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

global $woocommerce;

define( 'WC_LATEST_VERSION', '2.2' );

/* === HOOKS === */
function yit_woocommerce_hooks() {

    global $woocommerce;

    if ( ! defined( 'YIT_DEBUG' ) || ! YIT_DEBUG ) {
        $message = get_option( 'woocommerce_admin_notices', array() );
        $message = array_diff( $message, array( 'template_files' ) );
        update_option( 'woocommerce_admin_notices', $message );
    }

    /* wc 2.1 compatibility */
    if ( version_compare( preg_replace( '/-beta-([0-9]+)/', '', $woocommerce->version ), '2.2', '<' ) ) {
        add_filter( 'WC_TEMPLATE_PATH', 'yit_set_wc_template_path' );
    }

    add_action( 'yit_after_primary_starts', 'yit_single_product_title_bar' );
    add_action( 'woocommerce_before_main_content', 'yit_shop_page_meta' );
    add_action( 'yit_activated', 'yit_woocommerce_default_image_dimensions' );
    add_filter( 'woocommerce_enqueue_styles', 'yit_enqueue_wc_styles' );

    add_action( 'wp_head', 'yit_size_images_style' );

    // Use WC 2.0 variable price format, now include sale price strikeout
    add_filter( 'woocommerce_variable_sale_price_html', 'wc_wc20_variation_price_format', 10, 2 );
    add_filter( 'woocommerce_variable_price_html', 'wc_wc20_variation_price_format', 10, 2 );

    /* shop */
    add_filter( 'loop_shop_per_page', 'yit_products_per_page' );
    remove_action( 'woocommerce_before_shop_loop', 'woocommerce_result_count', 20 );
    remove_action( 'woocommerce_before_shop_loop', 'woocommerce_catalog_ordering', 30 );
    remove_action( 'woocommerce_after_shop_loop_item_title', 'woocommerce_template_loop_rating', 5 );
    add_action( 'shop-page-meta', 'yit_wc_catalog_ordering' );
    if ( yit_get_option( 'shop-enable-masonry' ) == 'no' ) {
        add_action( 'shop-page-meta', 'yit_wc_list_or_grid' );
    }

    if( yit_get_option( 'shop-products-per-page-option' ) != 'no' ) {
        add_action( 'shop-page-meta', 'yit_wc_num_of_products' );
    }

    if( yit_get_option( 'shop-product-category' ) == 'yes' ) { add_action( 'woocommerce_after_shop_loop_item_title', 'yit_get_product_category', 5 ); }
    add_action( 'woocommerce_after_shop_loop_item_title', 'yit_shop_rating', 10 );
    add_action( 'woocommerce_after_shop_loop_item_title', 'yit_shop_product_description', 15 );
    add_action( 'yith_add_to_cart_button', 'woocommerce_template_loop_add_to_cart', 10 );

    /* single product */

    function remove_woocommerce_breadcrumb () {
        if ( is_singular( array( 'product' ) ) ) {
            remove_action( 'woocommerce_before_main_content', 'woocommerce_breadcrumb', 20, 0 );
        }
    }
    add_action( 'woocommerce_before_main_content', 'remove_woocommerce_breadcrumb' );
    remove_action( 'woocommerce_before_single_product_summary', 'woocommerce_show_product_sale_flash', 10 );
    if ( yit_get_option( 'shop-single-product-price' ) == 'no' ) {
        remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_price', 10 );
    }
    if ( yit_get_option( 'shop-single-metas' ) == 'no' ) {
        remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_meta', 40 );
    }
    if ( yit_get_option( 'shop-show-related' ) == 'no' ) {
        remove_action( 'woocommerce_after_single_product_summary', 'woocommerce_output_related_products', 20 );
    }
    if ( yit_get_option( 'shop-show-custom-related' ) == 'yes' ) {
        add_action( 'woocommerce_related_products_args', 'yit_related_posts_per_page' );
    }
    add_action( 'woocommerce_single_product_summary', 'yit_product_modal_window', 25 );
    add_action( 'after_setup_theme', 'yit_add_inquiry_form_action', 40 );
    add_action( 'woocommerce_single_product_summary', 'yit_product_other_actions', 35 );
    add_action( 'woocommerce_product_thumbnails', 'woocommerce_show_product_sale_flash' );

    if ( yit_get_option( 'shop-remove-reviews' ) == 'yes' ) {
        add_filter( 'woocommerce_product_tabs', 'yit_remove_reviews_tab', 98 );
    }

    /* cart */
    remove_action( 'woocommerce_cart_collaterals', 'woocommerce_cross_sell_display' );
    add_action( 'woocommerce_after_cart', 'woocommerce_cross_sell_display' );

    /* checkout */
    remove_action( 'woocommerce_before_checkout_form', 'woocommerce_checkout_coupon_form' );

    /* admin */
    add_action( 'woocommerce_product_options_general_product_data', 'yit_woocommerce_admin_product_ribbon_onsale' );
    add_action( 'woocommerce_process_product_meta', 'yit_woocommerce_process_product_meta', 2, 2 );

    /* tabs */
    add_filter( 'woocommerce_product_tabs', 'yit_woocommerce_add_tabs' );

    /*add to cart button*/
    add_filter( 'add_to_cart_text', 'yit_add_to_cart_text' );

    /*ajax search loading*/
    add_filter( 'yith_wcas_ajax_search_icon', 'yit_loading_search_icon' );

	/* quick view */
	add_action( 'yit_load_quick_view', 'yit_woocommerce_quick_view' );

    /* MANAGE VAT AND SSN FIELDS */
    if ( yit_get_option( 'shop-enable-vat' ) == 'yes' && yit_get_option( 'shop-enable-ssn' ) == 'yes' ) {
        add_filter( 'woocommerce_billing_fields', 'yit_woocommerce_add_billing_ssn_vat' );
        add_filter( 'woocommerce_shipping_fields', 'yit_woocommerce_add_shipping_ssn_vat' );
        add_filter( 'woocommerce_admin_billing_fields', 'woocommerce_add_billing_shipping_fields_admin' );
        add_filter( 'woocommerce_admin_shipping_fields', 'woocommerce_add_billing_shipping_fields_admin' );
    }
    elseif ( yit_get_option( 'shop-enable-vat' ) == 'yes' ) {
        add_filter( 'woocommerce_billing_fields', 'yit_woocommerce_add_billing_vat' );
        add_filter( 'woocommerce_shipping_fields', 'yit_woocommerce_add_shipping_vat' );
        add_filter( 'woocommerce_admin_billing_fields', 'woocommerce_add_billing_shipping_vat_admin' );
        add_filter( 'woocommerce_admin_shipping_fields', 'woocommerce_add_billing_shipping_vat_admin' );
        add_filter( 'woocommerce_load_order_data', 'woocommerce_add_var_load_order_data_vat' );
    }
    elseif ( yit_get_option( 'shop-enable-ssn' ) == 'yes') {
        add_filter( 'woocommerce_billing_fields', 'yit_woocommerce_add_billing_ssn' );
        add_filter( 'woocommerce_shipping_fields', 'yit_woocommerce_add_shipping_ssn' );
        add_filter( 'woocommerce_admin_billing_fields', 'woocommerce_add_billing_shipping_ssn_fields_admin' );
        add_filter( 'woocommerce_admin_shipping_fields', 'woocommerce_add_billing_shipping_ssn_fields_admin' );
        add_filter( 'woocommerce_load_order_data', 'woocommerce_add_var_load_order_data_ssn' );
    }

    /* review */
    add_filter( 'comments_open', 'yit_woocommerce_show_review', 11, 2);

}

add_action( 'after_setup_theme', 'yit_woocommerce_hooks' );


if ( ! function_exists( 'yit_add_to_cart_text' ) ) {
    /**
     * Set Add to Cart label from Theme Options
     *
     * @return string
     *
     * @since 1.0.0
     */
    function yit_add_to_cart_text() {
        global $product;

        if ( $product->product_type != 'external' ) {
            $text = __( yit_get_option( 'shop-add-to-cart-text' ), 'yit' );
        }
        return $text;
    }
}


if ( ! function_exists( 'yit_set_wc_template_path' ) ) {
    /**
     * Return the folder of custom woocommerce templates
     *
     * @param $path
     *
     * @return string template folder
     *
     * @since    2.0.0
     */
    function yit_set_wc_template_path( $path ) {
        global $woocommerce;

        // Get major version string for woocommerce
        return 'woocommerce_' . substr( $woocommerce->version, 0, 3 ) . '.x/';

    }
}


if ( ! function_exists( 'yit_enqueue_wc_styles' ) ) {
    /**
     * Remove Woocommerce Styles add custom Yit Woocommerce style
     *
     * @param $styles
     *
     * @return array list of style files
     * @since    2.0.0
     */
    function yit_enqueue_wc_styles( $styles ) {
        global $woocommerce;

        $path = 'woocommerce';

        if ( version_compare( preg_replace( '/-beta-([0-9]+)/', '', $woocommerce->version ), WC_LATEST_VERSION, '<' ) ) {
            $path = 'woocommerce_' . substr( $woocommerce->version, 0, 3 ) . '.x';
        }

        unset( $styles['woocommerce-general'], $styles['woocommerce-layout'], $styles['woocommerce-smallscreen'] );

        $styles ['yit-layout'] = array(
            'src'     => get_stylesheet_directory_uri() . '/' . $path . '/style.css',
            'deps'    => '',
            'version' => '1.0',
            'media'   => ''
        );
        return $styles;
    }
}

if ( ! function_exists( 'yit_get_current_cart_info' ) ) {
    /**
     * Remove Woocommerce Styles add custom Yit Woocommerce style
     *
     * @internal param $styles
     *
     * @return array list of style files
     * @since    2.0.0
     */
    function yit_get_current_cart_info() {

        $subtotal  = WC()->cart->get_cart_subtotal();
        $items     = yit_get_option( 'shop-mini-cart-total-items' ) ? WC()->cart->get_cart_contents_count() : count( WC()->cart->get_cart() );
        $cart_icon = yit_get_option( 'shop-mini-cart-icon' );

        return array(
            $items,
            $subtotal,
            $cart_icon,
            get_woocommerce_currency_symbol(),
        );
    }
}

if ( ! function_exists( 'yit_shop_rating' ) ) {

    function yit_shop_rating() {
        global $product;

        if ( yit_get_option( 'shop-product-rating' ) == 'yes' ) {
            echo '<div class="product-rating"><span class="star-empty"><span class="star" style="width:' . ($product->get_average_rating())*20 . '%"></span></span></div>';
        }
    }
}

function woocommerce_template_loop_product_thumbnail() {

    global $product, $yit_products_layout, $woocommerce_loop;

    $attachments = $product->get_gallery_attachment_ids();
	$original_size = wc_get_image_size( 'shop_catalog' );

    if ( $woocommerce_loop['view'] == 'masonry_item' ) {
		$size = $original_size;
        $size['height'] = 0;
        YIT_Registry::get_instance()->image->set_size('shop_catalog', $size );
    }

    echo '<div class="thumb-wrapper ' . $yit_products_layout . '">';

    switch ( $yit_products_layout ) {

        case 'slideup':

            echo '<a href="' . get_permalink() . '" class="thumb">' . woocommerce_get_product_thumbnail() . '</a>';

            echo '<div class="quick-view'. ( ( yit_get_option( 'shop-use-quick-view' ) == 'no' ) ? ' none' : '' ) . '" data-product_id="' . esc_attr( $product->id ) . '">';
            if ( yit_get_option( 'shop-use-quick-view' ) == 'yes' ) {
                $sc_index = function_exists('YIT_Shortcodes') && YIT_Shortcodes()->is_inside ? '-' . YIT_Shortcodes()->index() : '';
                echo '<a id="quick-view-trigger-' . esc_attr( $product->id ) . $sc_index . '" href="#" class="trigger" data-item_id="'.$product->id.'">+ ' . yit_get_option( 'shop-quick-view-text' ) . '</a>';
            }
            elseif ( yit_get_option( 'shop-add-to-cart' ) == 'yes' ) {
                if ( ! $product->is_in_stock() ) {
                    echo '<p>' . __( 'Out of stock', 'yit' ) . '</p>';
                }
                elseif ( $product->product_type == 'simple' ) {
                    echo '<p>' . yit_get_option( 'shop-add-to-cart-text' ) . '</p>';
                }
                elseif ( $product->product_type == 'grouped' || $product->product_type == 'variable' ) {
                    echo '<p>' . __( 'View options', 'yit' ) . '</p>';
                }
                else {
                    echo '<p>' . __( 'Read more', 'yit' ) . '</p>';
                }
            }
            do_action( 'yith_add_to_cart_button' );
            echo '</div>';

            break;

        case 'classic':

            if( isset( $attachments[0] ) ) {
                echo '<a href="' . get_permalink() . '" class="thumb backface"><span class="face">' . woocommerce_get_product_thumbnail() . '</span>';
                echo '<span class="face back">';
                yit_image( "id=$attachments[0]&size=shop_catalog&class=image-hover" );
                echo '</span></a>';
            }
            else {
                echo '<a href="' . get_permalink() . '" class="thumb"><span class="face">' . woocommerce_get_product_thumbnail() . '</span></a>';
            }
            break;
    }
    echo '</div>';

	if ( $woocommerce_loop['view'] == 'masonry_item' ) {
		YIT_Registry::get_instance()->image->set_size('shop_catalog', $original_size );
	}

}

function yit_woocommerce_admin_product_ribbon_onsale() {
    wc_get_template( 'admin/custom-onsale.php' );
}

function yit_woocommerce_process_product_meta( $post_id, $post ) {

    $active = ( isset( $_POST['_active_custom_onsale'] ) ) ? 'yes' : 'no';
    update_post_meta( $post_id, '_active_custom_onsale', esc_attr( $active ) );

    if ( isset( $_POST['_preset_onsale_icon'] ) ) {
        update_post_meta( $post_id, '_preset_onsale_icon', esc_attr( $_POST['_preset_onsale_icon'] ) );
    }
    if ( isset( $_POST['_custom_onsale_icon'] ) ) {
        update_post_meta( $post_id, '_custom_onsale_icon', esc_attr( $_POST['_custom_onsale_icon'] ) );
    }
}

function yit_get_product_category() {
    global $product;
    echo '<span class="product_cat">' . $product->get_categories() . '</span>';
}

/**
 * SIZES
 */
// shop small
if ( ! function_exists( 'yit_shop_catalog_w' ) ) : function yit_shop_catalog_w() {
    $size = wc_get_image_size( 'shop_catalog' );
    return $size['width'];
} endif;
if ( ! function_exists( 'yit_shop_catalog_h' ) ) : function yit_shop_catalog_h() {
    $size = wc_get_image_size( 'shop_catalog' );
    return $size['height'];
} endif;
if ( ! function_exists( 'yit_shop_catalog_c' ) ) : function yit_shop_catalog_c() {
    $size = wc_get_image_size( 'shop_catalog' );
    return $size['crop'];
} endif;
// shop thumbnail
if ( ! function_exists( 'yit_shop_thumbnail_w' ) ) : function yit_shop_thumbnail_w() {
    $size = wc_get_image_size( 'shop_thumbnail' );
    return $size['width'];
} endif;
if ( ! function_exists( 'yit_shop_thumbnail_h' ) ) : function yit_shop_thumbnail_h() {
    $size = wc_get_image_size( 'shop_thumbnail' );
    return $size['height'];
} endif;
if ( ! function_exists( 'yit_shop_thumbnail_c' ) ) : function yit_shop_thumbnail_c() {
    $size = wc_get_image_size( 'shop_thumbnail' );
    return $size['crop'];
} endif;
//shop large
if ( ! function_exists( 'yit_shop_single_w' ) ) : function yit_shop_single_w() {
    $size = wc_get_image_size( 'shop_single' );
    return $size['width'];
} endif;
if ( ! function_exists( 'yit_shop_single_h' ) ) : function yit_shop_single_h() {
    $size = wc_get_image_size( 'shop_single' );
    return $size['height'];
} endif;
if ( ! function_exists( 'yit_shop_single_c' ) ) : function yit_shop_single_c() {
    $size = wc_get_image_size( 'shop_single' );
    return $size['crop'];
} endif;
// shop featured
if ( ! function_exists( 'yit_shop_featured_w' ) ) : function yit_shop_featured_w() {
    $size = wc_get_image_size( 'shop_featured' );
    return $size['width'];
} endif;
if ( ! function_exists( 'yit_shop_featured_h' ) ) : function yit_shop_featured_h() {
    $size = wc_get_image_size( 'shop_featured' );
    return $size['height'];
} endif;
if ( ! function_exists( 'yit_shop_featured_c' ) ) : function yit_shop_featured_c() {
    $size = wc_get_image_size( 'shop_featured' );
    return $size['crop'];
} endif;

/* CUSTOM TABS */

function yit_woocommerce_add_tabs( $tabs = array() ) {

    global $post;

    $custom_tabs = yit_get_post_meta( $post->ID, '_custom_tab' );

    if ( ! empty( $custom_tabs ) ) {
        foreach ( $custom_tabs as $tab ) {
            $tabs['custom' . $tab["position"]] = array(
                'title'      => $tab["name"],
                'priority'   => 30,
                'callback'   => 'yit_woocommerce_add_custom_panel',
                'custom_tab' => $tab
            );
        }
    }

    return $tabs;
}

function yit_woocommerce_add_custom_panel( $key, $tab ) {
    wc_get_template( 'single-product/tabs/custom.php', array( 'key' => $key, 'tab' => $tab ) );
}

function yit_add_inquiry_form_action(){

    if( ! function_exists('YIT_Contact_Form') ){
        return;
    }

    $args = array(
        'info_form' => array(
            'label' => __( 'Show ask info form?', 'yit' ),
            'desc'  => __( 'Set YES if you want a tab with the "Ask Info" form. Set options in Theme Options->Shop->Single Product Page', 'yit' ),
            'type'  => 'onoff',
            'std'   => 'no',
        )
    );

    $meta_prod = YIT_Metabox( 'yit-product-setting' );
    $meta_prod->add_field( 'settings', $args, 'before', 'modal_window' );

    add_action( 'woocommerce_single_product_summary', 'yit_woocommerce_add_inquiry_form', 32 );
}

function yit_woocommerce_add_inquiry_form() {
    wc_get_template( 'single-product/inquiry-form.php' );
}


function yit_single_product_title_bar() {
    if ( function_exists( 'WC' ) ) {
        if ( ! is_product() ) {
            return;
        }

        global $product;
        $args = array( 'delimiter' => ' > ' );

        echo '<div id="title_bar" class="clearfix title_bar_single_product">';
        echo '<div class="container">';
        echo '<div class="row">';
        echo '<div class="col-sm-12">';
        echo '<h2>' . $product->get_title() . '</h2>';
        woocommerce_breadcrumb( $args );
        wc_get_template( 'single-product/nav-links.php' );
        echo '</div>';
        echo '</div>';
        echo '</div>';
        echo '</div>';
    }
}

function yit_related_posts_per_page() {
    global $product;
    $related = $product->get_related( yit_get_option( 'shop-number-related' ) );
    return array(
        'posts_per_page'      => - 1,
        'post_type'           => 'product',
        'ignore_sticky_posts' => 1,
        'no_found_rows'       => 1,
        'post__in'            => $related
    );
}

function yit_product_other_actions() {
    wc_get_template( 'loop/other-actions.php' );
}

global $yith_woocompare;
if ( isset( $yith_woocompare ) ) {
    remove_action( 'woocommerce_after_shop_loop_item', array( $yith_woocompare->obj, 'add_compare_link' ), 20 );
    remove_action( 'woocommerce_single_product_summary', array( $yith_woocompare->obj, 'add_compare_link' ), 35 );
}

function yit_add_my_account_endpoint() {
    if ( function_exists( 'WC' ) ) {
        WC()->query->query_vars['recent-downloads'] = 'recent-downloads';
        WC()->query->query_vars['wishlist']         = 'wishlist';
    }
}

add_action( 'after_setup_theme', 'yit_add_my_account_endpoint' );

if ( ! function_exists( 'yit_my_account_template' ) ) {
    /**
     * Add custom template form my-account page
     *
     * @return   void
     * @since    2.0.0
     * @author   Francesco Licandro <francesco.licandro@yithemes.com>
     */
    function yit_my_account_template() {
        if ( function_exists( 'WC' ) && is_page( get_option( 'woocommerce_myaccount_page_id' ) ) ) {

            global $wp;

			if ( is_user_logged_in() ) {
				if ( ! is_rtl() ) {
                    echo '<div class="col-sm-3" id="my-account-sidebar">';
                    wc_get_template( '/myaccount/my-account-menu.php' );
                    echo '</div>';
                }

                echo '<div class="col-sm-9" id="my-account-content">';
                wc_print_notices();
                if ( ( ! isset( $wp->query_vars['recent-downloads'] ) ) && ( ! isset( $wp->query_vars['wishlist'] ) )
                    && ( ! isset( $wp->query_vars['edit-address'] ) ) && ( ! isset( $wp->query_vars['edit-account'] ) )
                    && ( ! isset( $wp->query_vars['view-order'] ) ) && ( ! isset( $wp->query_vars['lost-password'] ) )
                ) {
                    wc_get_template( 'myaccount/my-orders.php', array( 'order_count' => 15 ) );
                }
                elseif ( isset( $wp->query_vars['recent-downloads'] ) ) {
                    wc_get_template( 'myaccount/my-downloads.php' );
                }
                elseif ( isset( $wp->query_vars['wishlist'] ) ) {
                    echo do_shortcode( '[yith_wcwl_wishlist]' );
                }
                else {
                    yit_content_loop();
                }
                echo '</div>';

                if( is_rtl()) {
                    echo '<div class="col-sm-3" id="my-account-sidebar">';
                    wc_get_template( '/myaccount/my-account-menu.php' );
                    echo '</div>';
                }
            } else {
                echo '<div class="row" id="my-account-content">';
                if( isset( $wp->query_vars['lost-password'] ) ) {
                    WC_Shortcode_My_Account::lost_password();
                } else {
                    wc_get_template( 'myaccount/form-login.php' );
                }
                echo '</div>';
            }

        }
    }
}

if ( ! function_exists( 'yit_loading_search_icon' ) ) {

    function yit_loading_search_icon() {
        return '"' . YIT_THEME_ASSETS_URL . '/images/search.gif"';
    }
}

if ( ! function_exists( 'yit_shop_page_meta' ) ) {

    function yit_shop_page_meta() {
        if ( is_single() ) {
            return;
        }
        wc_get_template( '/global/page-meta.php' );
    }
}

if ( ! function_exists( 'yit_wc_catalog_ordering' ) ) {

    function yit_wc_catalog_ordering() {
        if ( ! is_single() && have_posts() ) {
            woocommerce_catalog_ordering();
        }
    }
}

if ( ! function_exists( 'yit_wc_list_or_grid' ) ) {

    function yit_wc_list_or_grid() {
        wc_get_template( '/global/list-or-grid.php' );
    }
}

if ( ! function_exists( 'yit_add_query_vars_filter' ) ) {

    function yit_add_query_vars_filter( $vars ) {

        $vars[] = "products-per-page";
        return $vars;
    }
}
add_filter( 'query_vars', 'yit_add_query_vars_filter' );

if ( ! function_exists( 'yit_wc_num_of_products' ) ) {

    function yit_wc_num_of_products() {
        wc_get_template( '/global/number-of-products.php' );
    }
}

if ( ! function_exists( 'yit_products_per_page' ) ) {

    function yit_products_per_page() {

        $num_prod = get_query_var( 'products-per-page' );

        if ( empty( $num_prod ) ) {
            $num_prod = yit_get_option( 'shop-products-per-page' );
        }
        elseif ( $num_prod == 'all' ) {
            $num_prod = wp_count_posts( 'product' )->publish;
        }

        return $num_prod;
    }
}

// print style for list view
if ( ! function_exists( 'yit_size_images_style' ) ) {

    function yit_size_images_style() {

        $content_width      = $GLOBALS['content_width'];
        $shop_catalog_w     = ( 100 * yit_shop_catalog_w() ) / $content_width;
        $info_product_width = 100 - $shop_catalog_w;

        ?>

        <style type="text/css">

            .woocommerce ul.products li.product.list .product-wrapper .thumb-wrapper {
                width: <?php echo $shop_catalog_w?>%;
                height: auto;
            }

            .woocommerce ul.products li.product.list .product-wrapper .info-product {
                width: <?php echo $info_product_width - 2 ?>%;
            }



            .woocommerce ul.products li.product.list .product-wrapper span.onsale {
            <?php if(!is_rtl()): ?>
                right: <?php echo $info_product_width + 0.61 ?>%;
            <?php else: ?>
                left: <?php echo $info_product_width + 0.61 ?>%;
            <?php endif;?>
            }



            .woocommerce ul.products li.product.list .product-wrapper .product-meta {
                width: <?php echo $info_product_width -2 ?>%;
            }

        </style>
    <?php
    }
}

if ( ! function_exists( 'yit_shop_product_description' ) ) {

    function yit_shop_product_description() {

        if ( yit_get_option( 'shop-product-description-on-list' ) == 'yes' ) {
            echo '<div class="product-description">';
            woocommerce_template_single_excerpt();
            echo '</div>';
        }
    }
}

function wc_wc20_variation_price_format( $price, $product ) {
    // Main Price
    $prices = array( $product->get_variation_price( 'min', true ), $product->get_variation_price( 'max', true ) );
    $price  = $prices[0] !== $prices[1] ? sprintf( __( '<span class="from">From: </span>%1$s', 'yit' ), wc_price( $prices[0] ) ) : wc_price( $prices[0] );
    // Sale Price
    $prices = array( $product->get_variation_regular_price( 'min', true ), $product->get_variation_regular_price( 'max', true ) );
    sort( $prices );
    $saleprice = $prices[0] !== $prices[1] ? sprintf( __( '<span class="from">From: </span>%1$s', 'yit' ), wc_price( $prices[0] ) ) : wc_price( $prices[0] );

    if ( $price !== $saleprice ) {
        $price = '<del>' . $saleprice . '</del> <ins>' . $price . '</ins>';
    }
    return $price;
}

if ( ! function_exists( 'yit_add_to_cart_success_ajax' ) ) {
    function yit_add_to_cart_success_ajax( $datas ) {

        list( $cart_items, $cart_subtotal, $cart_icon, $cart_currency ) = yit_get_current_cart_info();
        $datas['.yit_cart_widget .cart_label .cart-items .yit-mini-cart-icon'] = '<span class="yit-mini-cart-icon"><span class="cart-items-number">' . $cart_items . '</span></span>';
        return $datas;
    }

    add_filter( 'add_to_cart_fragments', 'yit_add_to_cart_success_ajax' );
}

// VAT SSN Fields

function yit_woocommerce_add_billing_ssn_vat( $fields ) {
    $fields['billing_vat'] = array(
        'label'       => apply_filters( 'yit_vat_label', __( 'VAT', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-first' ),
        'clear'       => false
    );

    $fields['billing_ssn'] = array(
        'label'       => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-last' ),
        'clear'       => true
    );

    return $fields;
}
function yit_woocommerce_add_shipping_ssn_vat( $fields ) {
    $fields['shipping_vat'] = array(
        'label'       => apply_filters( 'yit_vat_label', __( 'VAT', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-first' ),
        'clear'       => false
    );

    $fields['shipping_ssn'] = array(
        'label'       => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-last' ),
        'clear'       => true
    );

    return $fields;
}
function woocommerce_add_billing_shipping_fields_admin( $fields ) {
    $fields['vat'] = array(
        'label' => apply_filters( 'yit_vatssn_label', __( 'VAT', 'yit' ) )
    );
    $fields['ssn'] = array(
        'label' => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) )
    );

    return $fields;
}
function yit_woocommerce_add_billing_vat( $fields ) {
    $fields['billing_vat'] = array(
        'label'       => apply_filters( 'yit_vatssn_label', __( 'VAT / SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-wide' ),
        'clear'       => true
    );

    return $fields;
}
function yit_woocommerce_add_shipping_vat( $fields ) {
    $fields['shipping_vat'] = array(
        'label'       => apply_filters( 'yit_vatssn_label', __( 'VAT / SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-wide' ),
        'clear'       => true
    );

    return $fields;
}
function woocommerce_add_billing_shipping_vat_admin( $fields ) {
    $fields['vat'] = array(
        'label' => apply_filters( 'yit_vatssn_label', __( 'VAT/SSN', 'yit' ) )
    );

    return $fields;
}
function woocommerce_add_var_load_order_data_vat( $fields ) {
    $fields['billing_vat']  = '';
    $fields['shipping_vat'] = '';
    return $fields;
}
function yit_woocommerce_add_billing_ssn( $fields ) {
    $fields['billing_ssn'] = array(
        'label'       => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-wide' ),
        'clear'       => true
    );

    return $fields;
}

function yit_woocommerce_add_shipping_ssn( $fields ) {
    $fields['shipping_ssn'] = array(
        'label'       => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) ),
        'placeholder' => '',
        'required'    => false,
        'class'       => array( 'form-row-wide' ),
        'clear'       => true
    );

    return $fields;
}
function woocommerce_add_billing_shipping_ssn_fields_admin( $fields ) {
    $fields['ssn'] = array(
        'label' => apply_filters( 'yit_ssn_label', __( 'SSN', 'yit' ) )
    );

    return $fields;
}
function woocommerce_add_var_load_order_data_ssn( $fields ) {
    $fields['billing_ssn']  = '';
    $fields['shipping_ssn'] = '';
    return $fields;
}

function yit_woocommerce_quick_view() {
    global $woocommerce_loop;

	if ( ! function_exists('WC') || 'no' == yit_get_option('shop-use-quick-view') || ! isset( $woocommerce_loop['shown_product'] ) || ! $woocommerce_loop['shown_product'] ) {
        return false;
    }

    $suffix      = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';
    $assets_path = str_replace( array( 'http:', 'https:' ), '', WC()->plugin_url() ) . '/assets/';
    $lightbox_en = get_option( 'woocommerce_enable_lightbox' ) == 'yes' ? true : false;

    wp_enqueue_script( 'wc-add-to-cart-variation' );
    //wp_enqueue_script( 'yith_wccl_frontend' );
    wp_enqueue_style( 'yith_wccl_frontend' );

    //pretty photo
    if ( $lightbox_en ) {
        //wp_enqueue_script( 'prettyPhoto', WC()->plugin_url() . '/assets/js/prettyPhoto/jquery.prettyPhoto' . $suffix . '.js', array( 'jquery' ), '3.1.5', true );
        //wp_enqueue_script( 'prettyPhoto-init', WC()->plugin_url() . '/assets/js/prettyPhoto/jquery.prettyPhoto.init' . $suffix . '.js', array( 'jquery' ), WC()->version, true );
        wp_enqueue_style( 'woocommerce_prettyPhoto_css', WC()->plugin_url() . '/assets/css/prettyPhoto.css' );
    }

    // change position of woocommerce.js
    $queue = $GLOBALS['wp_scripts']->queue;
    $k = array_search( 'yit_woocommerce', $queue );
    $queue[] = $queue[ $k ];
    unset( $queue[ $k ] );
    $GLOBALS['wp_scripts']->queue = array_values( $queue );

    $registered = $GLOBALS['wp_scripts']->registered;

    wp_localize_script( 'yit_woocommerce', 'yit_quick_view', array(
        'ajaxurl' => admin_url( 'admin-ajax.php' ),
        'loading' => __( 'Loading', 'yit' ),
        'assets' => array(
            //$GLOBALS['wp_scripts']->registered['woocommerce']->src,
            //$GLOBALS['wp_scripts']->registered['jquery-custom']->src,
            $registered['wc-add-to-cart-variation']->src,
            isset( $registered['yith_wccl_frontend'] ) ? $registered['yith_wccl_frontend']->src : false,
            $assets_path . 'js/prettyPhoto/jquery.prettyPhoto' . $suffix . '.js',
            $assets_path . 'js/prettyPhoto/jquery.prettyPhoto.init' . $suffix . '.js'
        )
    ) );

    return true;
}

function yit_load_product_quick_view_ajax() {
    if ( ! isset( $_REQUEST['item_id'] ) ) {
        die();
    }

    $product_id = intval( $_REQUEST['item_id'] );

    // set the main wp query for the product
    wp( 'p=' . $product_id . '&post_type=product' );

    // remove parts from single product page
    remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_title',    5 );
    remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_rating',  10 );
    remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_price',   10 );
    remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_meta',    40 );
    remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_sharing', 50 );
    remove_all_actions( 'woocommerce_after_single_product_summary' );

    // change template for variable products
    if ( isset( $GLOBALS['yith_wccl'] ) ) {
        $GLOBALS['yith_wccl']->obj = new YITH_WCCL_Frontend( YITH_WCCL_VERSION );
        $GLOBALS['yith_wccl']->obj->override();
    }

    //wp_head();

    while ( have_posts() ) : the_post(); ?>

        <?php woocommerce_template_single_title(); ?>
        <?php woocommerce_template_single_rating(); ?>
        <?php woocommerce_template_single_price(); ?>

        <div class="single-product woocommerce">

            <?php wc_get_template_part( 'content', 'single-product' ); ?>

        </div>

    <?php endwhile; // end of the loop.

    //wp_footer();

    die();
}
add_action( 'wp_ajax_yit_load_product_quick_view', 'yit_load_product_quick_view_ajax' );
add_action( 'wp_ajax_nopriv_yit_load_product_quick_view', 'yit_load_product_quick_view_ajax' );

if ( ! function_exists( 'yit_product_modal_window' ) ){
    function yit_product_modal_window(){
        wc_get_template( 'single-product/modal-window.php');
    }
}


// SET LAYOUT FOR SHOP PAGE

function yit_sidebar_shop_page( $value, $key, $id ) {

    $new_layout = ( isset( $_GET['layout-shop'] ) ) ? $_GET['layout-shop'] : '';

    if( isset( $value['layout'] ) && $new_layout != '' && $key == 'sidebars' ) {

        $value['layout'] = $new_layout;

        if( $value['sidebar-left'] == -1 ){
            $value['sidebar-left'] = $value['sidebar-right'];
        }
        elseif( $value['sidebar-right'] == -1 ){
            $value['sidebar-right'] = $value['sidebar-left'];
        }
    }

    return $value;
}
add_filter( 'yit_get_option_layout', 'yit_sidebar_shop_page', 10, 3 );

//    if( ! function_exists('yit_add_wc_tables') ){
//        function yit_add_wc_tables( $tables ) {
//        $tables['plugins'][] = 'woocommerce%';
//        $tables['options'][] = '%woocommerce%';
//        $tables['options'][] = '%wc%';
//        $tables['options'][] = '%shop%';
//
//        /* === YITH WISHLIST  === */
//        if ( defined( 'YITH_WCWL_TABLE' ) ) {
//            $tables['plugins'][] = YITH_WCWL_TABLE;
//        }
//
//        return $tables;
//    }
//}

// REMOVE UNUSED OPTIONS FROM WISHLIST

function yit_remove_unused_wishlist_options( $options ){
    unset( $options['general_settings'][5] );

    return $options;
}
add_filter( 'yith_wcwl_tab_options', 'yit_remove_unused_wishlist_options' );

function yit_remove_unused_woocompare_options( $options ){
    unset( $options['general'][4] );

    return $options;
}
add_filter( 'yith_woocompare_tab_options', 'yit_remove_unused_woocompare_options' );


// add image for product category page

function woocommerce_taxonomy_archive_description() {

    if ( is_tax( array( 'product_cat', 'product_tag' ) ) && get_query_var( 'paged' ) == 0 ) {
        global $wp_query;

        $cat          = $wp_query->get_queried_object();
        $thumbnail_id = get_woocommerce_term_meta( $cat->term_id, 'thumbnail_id', true );
        $image        = wp_get_attachment_image_src( $thumbnail_id, 'full' );

        $description = apply_filters( 'the_content', term_description() );

        if ( $image && yit_get_option( 'shop-category-show-page-image' ) == 'yes' ) {
            echo '<div class="term-header-image"><img src="' . $image[0] . '" width="' . $image[1] . '" height="' . $image[1] . '" alt="' . $cat->name . '" /></div>';
        }

        if ( $description ) {
            echo '<div class="term-description">' . $description . '</div>';
        }
    }
}

if( ! function_exists( 'yit_remove_reviews_tab' ) ){

    function yit_remove_reviews_tab ( $tabs ) {

        unset( $tabs[ 'reviews' ] );
        return $tabs;
    }
}


if( ! function_exists( 'yit_woocommerce_show_review' ) ) {
    /**
     * hide or show reviews
     *
     * @param string $open the product
     *
     * @param string $post_id the post ID
     *
     * @return bool
     * @since  2.0.0
     * @author Emanuela Castorina <emanuela.castorina@yithemes.com>
     */
    function yit_woocommerce_show_review( $open, $post_id ) {
        $post = get_post( $post_id );
        if ( $post->post_type != 'product' ) {
            return $open;
        }
        return ( yit_get_option('shop-remove-reviews')== 'no' ) ? true : false;
    }
}