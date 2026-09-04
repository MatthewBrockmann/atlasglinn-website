<?php
/**
 * Inquiry form
 */
global $post;

$show = yit_get_post_meta( $post->ID, '_info_form');
$form_id = yit_get_option('shop-single-product-contact-form');
$icon = yit_get_option( 'shop-inquiry-title-icon' );

if( $show == 'yes' ) : ?>
    <div id="inquiry-form">
    <div class="product-inquiry">
        <?php if ( $icon['select'] != 'none' ) :
                if( $icon['select'] == 'icon' ) { ?>
                    <span class="fa fa-<?php echo $icon['icon']; ?>"></span>
                <?php } else{ ?>
                    <span class="custom-icon"><img src="<?php echo $icon['custom']; ?>"></span>
                <?php }
         endif; ?>
        <h4><?php echo yit_get_option( 'shop-inquiry-title' ) ?></h4>
    </div>
    <?php echo do_shortcode( '[contact_form name="'. $form_id .'" ]' ) ?>
    </div>
<?php endif ?>

<div class="clear"></div>