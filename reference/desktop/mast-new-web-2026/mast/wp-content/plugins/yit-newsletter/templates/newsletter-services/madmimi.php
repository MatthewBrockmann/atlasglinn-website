<?php
/**
 * This file belongs to the YIT Plugin Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */

/**
 * Template file for mailchimp subscription form
 *
 * @package Yithemes
 * @author Antonio La Rocca <antonio.larocca@yithemes.it>
 * @since 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

?>

<div class="message-box"></div>
<form method="post" action="#">
    <fieldset>
        <ul class="group">
            <li>
                <?php
                if($shortcode == 'newsletter_form'):
                    ?>
                    <label for="yit_madmimi_newsletter_form_email"><?php _e( 'Email', 'yit' ) ?></label>
                <?php
                endif;
                ?>
                <div class="newsletter_form_email">
                    <input type="text" <?php echo ( $shortcode == 'newsletter_cta' ) ? 'placeholder="' . __( 'Email', 'yit' ) . '"' : ''?> name="yit_madmimi_newsletter_form_email" id="yit_madmimi_newsletter_form_email" class="email-field text-field autoclear" />
                    <?php if( isset( $icon_form ) && $icon_form != '-1' ): ?>
                    <span class="fa mail-icon-<?php echo ( isset( $widget ) && $widget ) ? 'widget' : 'shortcode'; ?>"></span>
                    <style>
                        .mail-icon-<?php echo ( isset($widget) && $widget ) ? 'widget' : 'shortcode'; ?>:before {
                            content: "\<?php echo $icon_form; ?>";
                        }
                    </style>
                    <?php endif; ?>
                </div>
            </li>
            <li>
                <input type="hidden" name="yit_madmimi_newsletter_form_id" value="<?php echo $post_id?>"/>
                <input type="hidden" name="action" value="subscribe_madmimi_user"/>
                <?php wp_nonce_field( 'yit_madmimi_newsletter_form_nonce', 'yit_madmimi_newsletter_form_nonce'); ?>
                <input class="button btn btn-alternative submit-field madmimi-subscription-ajax-submit" type="button" value="<?php _e( 'Submit', 'yit' ) ?>" />
            </li>
        </ul>
    </fieldset>
</form>

<?php
yit_enqueue_script( 'yit-madmimi-ajax-send-form', YIT_Newsletter()->plugin_assets_url.'/js/madmimi-ajax-subscribe.js', array( 'jquery' ), '', true);
wp_localize_script( 'yit-madmimi-ajax-send-form', 'madmimi_localization', array( 'url' => admin_url( 'admin-ajax.php' ), 'error_message' => 'Ops! Something went wrong' ) );
?>
