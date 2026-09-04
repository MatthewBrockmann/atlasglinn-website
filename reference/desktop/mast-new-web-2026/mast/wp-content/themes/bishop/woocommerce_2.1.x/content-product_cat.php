<?php
/**
 * The template for displaying product category thumbnails within loops.
 *
 * Override this template by copying it to yourtheme/woocommerce/content-product_cat.php
 *
 * @author        WooThemes
 * @package       WooCommerce/Templates
 * @version       1.6.4
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

global $woocommerce_loop;

// Store loop count we're currently on
if ( empty( $woocommerce_loop['loop'] ) ) {
    $woocommerce_loop['loop'] = 0;
}

$woocommerce_loop['li_class'] = array();

//standard li class
$woocommerce_loop['li_class'][] = 'product-category product';

if ( YIT_Layout()->sidebars['layout'] == 'sidebar-double' ) {
    $woocommerce_loop['li_class'][] = 'col-sm-6';
    $woocommerce_loop['columns']    = '2';
}
elseif ( YIT_Layout()->sidebars['layout'] == 'sidebar-right' || YIT_Layout()->sidebars['layout'] == 'sidebar-left' ) {
    $woocommerce_loop['li_class'][] = 'col-sm-4';
    $woocommerce_loop['columns']    = '3';
}
else {
    $woocommerce_loop['li_class'][] = 'col-sm-3';
    $woocommerce_loop['columns']    = '4';
}

// Increase loop count
$woocommerce_loop['loop'] ++;

// add class first/last
if ( ( $woocommerce_loop['loop'] - 1 ) % $woocommerce_loop['columns'] == 0 || $woocommerce_loop['columns'] == 1 ) {
    $woocommerce_loop['li_class'][] = 'first';
}
if ( $woocommerce_loop['loop'] % $woocommerce_loop['columns'] == 0 ) {
    $woocommerce_loop['li_class'][] = 'last';
}

// add class style
if ( isset( $style ) && $style == 'white' ) {
    $woocommerce_loop['li_class'][] = ' white';
}
if ( isset( $style ) && $style == 'black' ) {
    $woocommerce_loop['li_class'][] = ' black';
}

?>

<li <?php post_class( $woocommerce_loop['li_class'] ) ?> >

    <?php do_action( 'woocommerce_before_subcategory', $category ); ?>

    <a href="<?php echo get_term_link( $category->slug, 'product_cat' ); ?>" class="product-category-link">

        <div class="category-thumb">
            <?php
            /**
             * woocommerce_before_subcategory_title hook
             *
             * @hooked woocommerce_subcategory_thumbnail - 10
             */
            do_action( 'woocommerce_before_subcategory_title', $category );
            ?>
        </div>

        <div class="show-category-background">

            <h3>
                <?php
                echo $category->name;

                if ( ( isset( $show_counter ) && $show_counter == 1 ) && $category->count > 0 ) {
                    echo yit_category_page_product_counter( $category->count, $category );
                }
                else {
                    if ( yit_get_option( "shop-category-show-counter" ) == "yes" && $category->count > 0 ) {
                        echo yit_category_page_product_counter( $category->count, $category );
                    }
                }

                if ( isset( $discovery_text ) && $discovery_text != '' ) {
                    ?><span class="discovery-text"><?php echo $discovery_text ?></span>
                <?php
                }
                ?>
            </h3>

        </div>

        <?php
        /**
         * woocommerce_after_subcategory_title hook
         */
        do_action( 'woocommerce_after_subcategory_title', $category );
        ?>

    </a>

    <?php do_action( 'woocommerce_after_subcategory', $category ); ?>

</li>