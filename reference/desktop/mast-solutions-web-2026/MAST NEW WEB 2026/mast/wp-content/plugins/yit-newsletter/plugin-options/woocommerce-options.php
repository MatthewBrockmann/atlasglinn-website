<?php
/**
 * This file belongs to the YIT Plugin Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
} // Exit if accessed directly

return array(
    'woocommerce' => array(

        /* =================== HOME =================== */
        'home'    => array(
            array( 'name' => __( 'Newsletter WooCommerce Settings', 'yiw' ),
                   'type' => 'title' ),


            array( 'type' => 'close' )
        ),
        /* =================== END SKIN =================== */

        'general'  => array(
            array( 'type' => 'open' ),

            array( 'name' => __( 'Enable WooCommerce Integration Popup', 'yit' ),
                   'desc' => __( 'If the option is enabled, the popup shows the informations about the WooCommerce products selected below. (Default: Off) ', 'yit' ),
                   'id'   => 'newsletter_popup_woocommerce_integration_enable',
                   'type' => 'on-off',
                   'std'  => 'no' ),

            array( 'name' => __( 'Woocommerce Product', 'yit' ),
                   'desc' => __( 'Select the product that you would like to show in your popup.', 'yit' ),
                   'id'   => 'newsletter_popup_woocommerce_ids',
                   'type' => 'select',
                   'options' => YIT_Newsletter()->get_WC_product(),
                   'std'  => apply_filters( 'yit_newsletter_popup_woocommerce_ids_std', false ),
                   'deps' => array(
                       'ids' => 'newsletter_popup_woocommerce_integration_enable',
                       'values' => 'yes'
                   )),

            array( 'name' => __( 'Woocommerce add to cart button', 'yit' ),
                   'desc' => __( 'Write here the text that you would like to display in "Add to cart" button', 'yit' ),
                   'id'   => 'newsletter_popup_woocommerce_button',
                   'type' => 'text',
                   'std'  => '',
                   'deps' => array(
                       'ids' => 'newsletter_popup_woocommerce_integration_enable',
                       'values' => 'yes'
                   )),

            array( 'type' => 'close' )
        )
    ),
);
