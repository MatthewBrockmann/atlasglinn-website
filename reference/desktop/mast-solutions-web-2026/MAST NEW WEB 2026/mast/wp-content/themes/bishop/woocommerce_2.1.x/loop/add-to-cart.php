<?php
/**
 * Loop Add to Cart
 *
 * @author        WooThemes
 * @package       WooCommerce/Templates
 * @version       2.1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

global $product, $yit_products_layout;

$shop_enabled = get_post_meta( $product->id, '_shop-enable', true );

if ( yit_get_option( 'shop-enable' ) == 'no' || yit_get_option( 'shop-add-to-cart' ) == 'no' || $shop_enabled != 'default' && $shop_enabled == 'no' ) {
    return;
}

if( ! isset( $yit_products_layout ) || $yit_products_layout == 'default' ) { $yit_products_layout = yit_get_option( 'shop-layout-type' ) ; }

?>

<?php if ( ! $product->is_in_stock() ) {
    if ( $yit_products_layout == 'slideup' && ( ! ( isset( $_REQUEST['action'] ) && ( $_REQUEST['action'] == 'yith-woocompare-view-table' || $_REQUEST['action'] == 'yith-woocompare-add-product' || $_REQUEST['action'] == 'yith-woocompare-remove-product' ) ) ) && ! ( isset( $in_swiper_slider ) && $in_swiper_slider ) ) {
        $img = ( yit_get_option( 'shop-slide-out-stock-icon' ) != '' ) ? yit_get_option( 'shop-slide-out-stock-icon' ) : get_template_directory_uri() . '/images/ico-outofstock.png'; ?>
        <a href="<?php echo apply_filters( 'out_of_stock_add_to_cart_url', get_permalink( $product->id ) ); ?>" class="out-of-stock"><img src="<?php echo $img ?>" class="ico-cart" /></a>
    <?php }
    else { ?>
        <a href="<?php echo apply_filters( 'out_of_stock_add_to_cart_url', get_permalink( $product->id ) ); ?>" class="out-of-stock btn btn-alternative"><?php echo apply_filters( 'out_of_stock_add_to_cart_text', __( 'Out Of Stock', 'yit' ) ); ?></a>
    <?php
    }
}
else {

    $link = array(
        'url'      => '',
        'label'    => '',
        'class'    => '',
        'quantity' => 1
    );

    $handler = apply_filters( 'woocommerce_add_to_cart_handler', $product->product_type, $product );

    switch ( $handler ) {
        case "variable" :
            $link['url']   = apply_filters( 'variable_add_to_cart_url', get_permalink( $product->id ) );
            $link['label'] = apply_filters( 'variable_add_to_cart_text', __( 'Set options', 'yit' ) );
            break;
        case "grouped" :
            $link['url']   = apply_filters( 'grouped_add_to_cart_url', get_permalink( $product->id ) );
            $link['label'] = apply_filters( 'grouped_add_to_cart_text', __( 'View options', 'yit' ) );
            break;
        case "external" :
            $link['url']   = apply_filters( 'external_add_to_cart_url', get_permalink( $product->id ) );
            $link['label'] = apply_filters( 'external_add_to_cart_text', __( 'Read More', 'yit' ) );
            break;
        default :
            if ( $product->is_purchasable() ) {
                $link['url']      = apply_filters( 'add_to_cart_url', esc_url( $product->add_to_cart_url() ) );
                $link['label']    = apply_filters( 'add_to_cart_text', __( 'Add to cart', 'yit' ) );
                $link['class']    = apply_filters( 'add_to_cart_class', 'add_to_cart_button' );
                $link['quantity'] = apply_filters( 'add_to_cart_quantity', ( get_post_meta( $product->id, 'minimum_allowed_quantity', true ) ? get_post_meta( $product->id, 'minimum_allowed_quantity', true ) : 1 ) );
            }
            else {
                $link['url']   = apply_filters( 'not_purchasable_url', get_permalink( $product->id ) );
                $link['label'] = apply_filters( 'not_purchasable_text', __( 'Read More', 'yit' ) );
            }
            break;
    }

    if ( $yit_products_layout == 'slideup' && ( ! ( isset( $_REQUEST['action'] ) && ( $_REQUEST['action'] == 'yith-woocompare-view-table' || $_REQUEST['action'] == 'yith-woocompare-add-product' || $_REQUEST['action'] == 'yith-woocompare-remove-product' ) ) ) && ! ( isset( $in_swiper_slider ) && $in_swiper_slider ) ) {

        if ( ! $product->is_in_stock() ) {
            $img = ( yit_get_option( 'shop-slide-out-stock-icon' ) != '' ) ? yit_get_option( 'shop-slide-out-stock-icon' ) : get_template_directory_uri() . '/images/ico-outofstock.png';
        }
        elseif ( $handler == 'simple' || $handler == 'bundle' ) {
            $img = ( yit_get_option( 'shop-slide-add-cart-icon' ) != '' ) ? yit_get_option( 'shop-slide-add-cart-icon' ) : get_template_directory_uri() . '/images/ico-cart.png';
        }
        elseif ( $handler == 'variable' || $handler == 'grouped' ) {
            $img = ( yit_get_option( 'shop-slide-set-option-icon' ) != '' ) ? yit_get_option( 'shop-slide-set-option-icon' ) : get_template_directory_uri() . '/images/ico-view.png';
        }

        $image_size = yit_getimagesize( $img );
        echo apply_filters( 'woocommerce_loop_add_to_cart_link', sprintf( '<a href="%s" rel="nofollow" data-product_id="%s" data-quantity="%s" data-product_sku="%s" class="%s product_type_%s"><img src="' . $img . '" class="ico-cart" height="'. $image_size[1] . '" width="'. $image_size[0] . '"/></a>', esc_url( $link['url'] ), esc_attr( $product->id ), esc_attr( $link['quantity'] ), esc_attr( $product->get_sku() ), esc_attr( $link['class'] ), esc_attr( $product->product_type ) ), $product, $link );
    }
    else {

        echo apply_filters( 'woocommerce_loop_add_to_cart_link', sprintf( '<a href="%s" rel="nofollow" data-product_id="%s" data-quantity="%s" data-product_sku="%s" class="%s btn %s product_type_%s">%s</a>', esc_url( $link['url'] ), esc_attr( $product->id ), esc_attr( $link['quantity'] ), esc_attr( $product->get_sku() ), esc_attr( $link['class'] ), ( isset( $in_swiper_slider ) && $in_swiper_slider ) ? $button_class : "btn-alternative", esc_attr( $product->product_type ), esc_html( $link['label'] ) ), $product, $link );

    }
}



