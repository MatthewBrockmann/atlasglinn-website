<?php global $product; ?>
<li>
    <a href="<?php echo esc_url( get_permalink( $product->id ) ); ?>" title="<?php echo esc_attr( $product->get_title() ); ?>">
        <?php echo $product->get_image(); ?>
        <span class="product_title"><?php echo $product->get_title(); ?></span>
    </a>
    <span class="product_cat"><?php echo $product->get_categories(); ?></span>
    <?php if ( ! empty( $show_rating ) ) echo $product->get_rating_html(); ?>
    <span class="product_price"><?php echo $product->get_price_html(); ?></span>
</li>