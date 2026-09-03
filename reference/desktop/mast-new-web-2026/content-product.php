<?php
/**
 * The template for displaying product content within loops.
 *
 * Override this template by copying it to yourtheme/woocommerce/content-product.php
 *
 * @author 		WooThemes
 * @package 	WooCommerce/Templates
 * @version     1.6.4
 */

if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

global $product, $woocommerce_loop, $post, $yit_products_layout;

$woocommerce_loop['shown_product'] = true;

// Set the products layout style
if( ! isset( $yit_products_layout ) || $yit_products_layout == 'default' ) {
    $yit_products_layout = yit_get_option( 'shop-layout-type' );
}

//Store loop count we're currently on
if ( empty( $woocommerce_loop['loop'] ) )
    $woocommerce_loop['loop'] = 0;

// Ensure visibility
if ( ! $product || ! $product->is_visible() )
    return;

// Increase loop count
$woocommerce_loop['loop']++;

// Extra post classes
$woocommerce_loop['li_class'] = array();

// view
if ( ! ( isset( $woocommerce_loop['view'] ) && ! empty( $woocommerce_loop['view'] ) ) && ( yit_get_option( 'shop-enable-masonry' ) == 'no' ) ) {
    $woocommerce_loop['view'] = yit_get_option( 'shop-view-type', 'grid' );
}
elseif ( yit_get_option( 'shop-enable-masonry' ) == 'yes' ) {
    $woocommerce_loop['view'] = 'masonry_item';
}

$woocommerce_loop['li_class'][] = $woocommerce_loop['view'];

// Set column
if ( ( is_shop() || is_product_category() ) && yit_get_option( 'shop-enable-masonry' ) == 'no' ) {
    $woocommerce_loop['li_class'][] = 'col-sm-' . intval( 12/ intval( yit_get_option( 'shop-num-column' ) ) );
    $woocommerce_loop['columns'] = intval( yit_get_option( 'shop-num-column' ) );
}
else{

    $sidebar = YIT_Layout()->sidebars;

    if ( $sidebar['layout'] == 'sidebar-double' ){
        $woocommerce_loop['li_class'][] = 'col-sm-6';
        $woocommerce_loop['columns'] = '2';
    }
    elseif ( $sidebar['layout'] == 'sidebar-right' ||  $sidebar['layout'] == 'sidebar-left' ) {
        $woocommerce_loop['li_class'][] = 'col-sm-4';
        $woocommerce_loop['columns'] = '3';
    }
    else {
        $woocommerce_loop['li_class'][] = 'col-sm-3';
        $woocommerce_loop['columns'] = '4';
    }
}


// Add class first or last
if ( 0 == ( $woocommerce_loop['loop'] - 1 ) % $woocommerce_loop['columns'] || 1 == $woocommerce_loop['columns'] )
    $woocommerce_loop['li_class'][] = 'first';
if ( 0 == $woocommerce_loop['loop'] % $woocommerce_loop['columns'] )
    $woocommerce_loop['li_class'][] = 'last';

if ( yit_get_option('shop-enable') == 'no' || yit_get_option( 'shop-product-price' ) == 'no' )  remove_action( 'woocommerce_after_shop_loop_item_title', 'woocommerce_template_loop_price' );

?>
<li <?php post_class( $woocommerce_loop['li_class'] ); ?> >

    <div class="product-wrapper">

        <?php do_action( 'woocommerce_before_shop_loop_item' ); ?>

        <?php
        /**
         * woocommerce_before_shop_loop_item_title hook
         *
         * @hooked woocommerce_show_product_loop_sale_flash - 10
         * @hooked woocommerce_template_loop_product_thumbnail - 10
         */
        do_action( 'woocommerce_before_shop_loop_item_title' );
        ?>
        <div class="clearfix info-product <?php echo $yit_products_layout ?>">
            <?php if ( yit_get_option('shop-product-title') == 'yes' ): ?>
                <h3<?php //echo $title_class ?>>
                    <a href="<?php the_permalink() ?>"><?php the_title(); ?></a>
                </h3>
            <?php endif ?>

            <?php
            /**
             * woocommerce_after_shop_loop_item_title hook
             *
             * @hooked woocommerce_template_loop_price - 10
             * @hooked woocommerce_template_loop_rating - 5
             */
            do_action( 'woocommerce_after_shop_loop_item_title' ); ?>
        </div>

        <?php if ( $yit_products_layout == 'classic' ): ?>
            <div class="product-meta">
                <div class="product-meta-wrapper">

                    <?php do_action( 'woocommerce_after_shop_loop_item' ); ?>

                </div>
            </div>
        <?php endif; ?>

    </div>

</li>
