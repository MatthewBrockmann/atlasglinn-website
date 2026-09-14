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
 * Template file for custom newsletter form
 *
 * @package Yithemes
 * @author Antonio La Rocca <antonio.larocca@yithemes.it>
 * @since 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly


$show_placeholder = apply_filters( 'yit_show_placeholder', ( $shortcode == 'newsletter_cta' ), $shortcode  );
$placeholder = ($show_placeholder ) ? 'placeholder="' . $email_label . '"' : '';
?>

<form method="<?php echo $method?>" action="<?php echo $action?>">
    <fieldset>
        <ul class="group">
            <li>
                <?php
                if($shortcode == 'newsletter_form'):
                ?>
                <label for="<?php echo $email_name ?>"><?php echo $email_label?></label>
                <?php
                endif;
                ?>
                <div class="newsletter_form_email">
                    <input type="text" <?php echo $placeholder ?> name="<?php echo $email_name ?>" id="<?php echo $email_name ?>" class="email-field text-field autoclear" />
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
                <?php
                if ( $hidden_fields != '' ) {
                    $hidden_fields = explode( '&', $hidden_fields );
                    foreach ( $hidden_fields as $field ) {
                        list( $id_field, $value_field ) = explode( '=', $field );
                        echo '<input type="hidden" name="' . $id_field . '" value="' . $value_field . '" />';
                    }
                }
                wp_nonce_field( 'mc_submit_signup_form', '_mc_submit_signup_form_nonce', false, true ); //MailChimp nonce
                wp_nonce_field( 'mymail_form_nonce', '_wpnonce', false, true ); //MyMail nonce
                ?>
                <input type="submit" class="btn btn-alternative" value="<?php echo $submit_label?>" class="submit-field" />
            </li>
        </ul>
    </fieldset>
</form>
