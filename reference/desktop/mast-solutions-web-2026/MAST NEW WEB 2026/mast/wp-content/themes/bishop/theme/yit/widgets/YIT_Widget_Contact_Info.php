<?php
/*
 * This file belongs to the YIT Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */
if (!defined('YIT')) {exit('Direct access forbidden.');
}
/**
 * Contact info Cart Widget
 *
 * Displays custom contact info
 *
 * @class YIT_Widget_Contact_Info
 * @extends WP_Widget
 * @package	Yithemes
 * @author  YIThemes
 *
 * @since Version 2.0.0
 */
if( !class_exists( 'YIT_Widget_Contact_Info' ) ) :
    class YIT_Widget_Contact_Info extends WP_Widget
    {
        var $woo_widget_cssclass;
        var $woo_widget_description;
        var $woo_widget_idbase;
        var $woo_widget_name;
        var $awesome_icons;

        /**
         * constructor
         *
         * @access public
         * @return void
         */
        function YIT_Widget_Contact_Info()
        {
            /* Widget variable settings. */
            $this->woo_widget_cssclass 		= 'contact-info';
            $this->woo_widget_description 	=__( 'Widget with a simple contact information.', 'yit' );
            $this->woo_widget_idbase 		= 'contact-info';
            $this->woo_widget_name 			=__( 'Contact Info', 'yit' );
            $this->awesome_icons = YIT_Plugin_Common::get_awesome_icons();

            $widget_ops = array( 'classname' => $this->woo_widget_cssclass, 'description' => $this->woo_widget_description );

            /* Create the widget. */
            $this->WP_Widget( 'contact-info', $this->woo_widget_name, $widget_ops );

            //wp_enqueue_script( 'media-upload' );
        }

        /**
         * form function.
         *
         * @see WP_Widget->form
         * @access public
         * @param array $instance
         * @return void
         */
        function form( $instance )
        {
            global $icons_name;

            /* Impostazioni di default del widget */
            $defaults = array(
                'title' => __( 'Contacts', 'yit' ),
                'subtitle' => '',
                'address' => '',
                'address_image' => '',
                'phone' => '',
                'phone_image' => '',
                'mobile' => '',
                'mobile_image' => '',
                'email' => '',
                'email_image' => '',
                'fax' => '',
                'fax_image' => ''
            );

            $instance = wp_parse_args( (array) $instance, $defaults ); ?>

            <p>
                <label>
                    <strong><?php _e( 'Title', 'yit' ) ?>:</strong><br />
                    <input class="widefat" type="text" id="<?php echo $this->get_field_id( 'title' ); ?>" name="<?php echo $this->get_field_name( 'title' ); ?>" value="<?php echo $instance['title']; ?>" />
                </label>
            </p>

            <p>
                <label>
                    <strong><?php _e( 'Sub Title', 'yit' ) ?>:</strong><br />
                    <input class="widefat" type="text" id="<?php echo $this->get_field_id( 'subtitle' ); ?>" name="<?php echo $this->get_field_name( 'subtitle' ); ?>" value="<?php echo $instance['subtitle']; ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Address', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'address' ); ?>" name="<?php echo $this->get_field_name( 'address' ); ?>" value="<?php echo $instance['address'] ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Address icon', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'address_image' ); ?>" name="<?php echo $this->get_field_name( 'address_image' ); ?>" value="<?php echo $instance['address_image']; ?>" />
                    <input type="button" value="<?php _e( 'Upload', 'yit' ) ?>" id="<?php echo $this->get_field_id( 'address_image' ); ?>-button" class="upload_button button" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Phone', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'phone' ); ?>" name="<?php echo $this->get_field_name( 'phone' ); ?>" value="<?php echo $instance['phone']; ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Phone icon', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'phone_image' ); ?>" name="<?php echo $this->get_field_name( 'phone_image' ); ?>" value="<?php echo $instance['phone_image']; ?>" />
                    <input type="button" value="<?php _e( 'Upload', 'yit' ) ?>" id="<?php echo $this->get_field_id( 'phone_image' ); ?>-button" class="upload_button button" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Mobile', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'mobile' ); ?>" name="<?php echo $this->get_field_name( 'mobile' ); ?>" value="<?php echo $instance['mobile']; ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Mobile icon', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'mobile_image' ); ?>" name="<?php echo $this->get_field_name( 'mobile_image' ); ?>" value="<?php echo $instance['mobile_image']; ?>" />
                    <input type="button" value="<?php _e( 'Upload', 'yit' ) ?>" id="<?php echo $this->get_field_id( 'mobile_image' ); ?>-button" class="upload_button button" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Fax', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'fax' ); ?>" name="<?php echo $this->get_field_name( 'fax' ); ?>" value="<?php echo $instance['fax']; ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Fax icon', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'fax_image' ); ?>" name="<?php echo $this->get_field_name( 'fax_image' ); ?>" value="<?php echo $instance['fax_image']; ?>" />
                    <input type="button" value="<?php _e( 'Upload', 'yit' ) ?>" id="<?php echo $this->get_field_id( 'fax_image' ); ?>-button" class="upload_button button" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Email', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'email' ); ?>" name="<?php echo $this->get_field_name( 'email' ); ?>" value="<?php echo $instance['email']; ?>" />
                </label>
            </p>

            <p>
                <label><?php _e( 'Email icon', 'yit' ) ?>:
                    <input type="text" id="<?php echo $this->get_field_id( 'email_image' ); ?>" name="<?php echo $this->get_field_name( 'email_image' ); ?>" value="<?php echo $instance['email_image']; ?>" />
                    <input type="button" value="<?php _e( 'Upload', 'yit' ) ?>" id="<?php echo $this->get_field_id( 'email_image' ); ?>-button" class="upload_button button" />
                </label>
            </p>

        <?php
        }

        /**
         * widget function.
         *
         * @see WP_Widget
         * @access public
         * @param array $args
         * @param array $instance
         * @return void
         */
        function widget( $args, $instance )
        {
            extract( $args );

            $title = apply_filters('widget_title', $instance['title'] );
            $subtitle =  $instance['subtitle'];

            echo $before_widget;



            if ( $title ) echo $before_title . $title . $after_title;

            if ($subtitle) echo "<h2>".$subtitle."</h2>";

            $address_image = ( isset($instance['address_image']) && $instance['address_image'] != '') ? '<div class="icon-container"><img src="' . $instance['address_image'] . '" alt="' . __( 'Location', 'yit' ) . '" /></div>' : '';
            $phone_image = ( isset($instance['phone_image']) && $instance['phone_image'] != '') ? '<div class="icon-container"><img src="' . $instance['phone_image'] . '" alt="' . __( 'Phone', 'yit' ) . '" /></div>' : '';
            $mobile_image = ( isset($instance['mobile_image']) && $instance['mobile_image'] != '') ? '<div class="icon-container"><img src="' . $instance['mobile_image'] . '" alt="' . __( 'Mobile', 'yit' ) . '" /></div>' : '';
            $fax_image = ( isset($instance['fax_image']) && $instance['fax_image'] != '') ? '<div class="icon-container"><img src="' . $instance['fax_image'] . '" alt="' . __( 'Fax', 'yit' ) . '" /></div>' : '';
            $email_image = ( isset($instance['email_image']) && $instance['email_image'] != '') ? '<div class="icon-container"><img src="' . $instance['email_image'] . '" alt="' . __( 'Email', 'yit' ) . '" /></div>' : '';

            $text = '<div class="sidebar-nav">';
            $text .= '  <ul>';
            $text .= ( !empty( $instance['address'] ) ) ? '<li>' . $address_image . '<div class="info-container"><strong>' . __( 'Location', 'yit' ) . ':</strong>' . do_shortcode( $instance['address'] ) . '</div></li>' : '';
            $text .= ( !empty( $instance['phone'] ) ) ? '<li>' . $phone_image . '<div class="info-container"><strong>' . __( 'Phone', 'yit' ) . ':</strong> ' . do_shortcode( $instance['phone'] ) . '</div></li>' : '';
            $text .= ( !empty( $instance['mobile'] ) ) ? '<li>' . $mobile_image . '<div class="info-container"><strong>' . __( 'Mobile', 'yit' ) . ':</strong> ' . do_shortcode( $instance['mobile'] ) . '</div></li>' : '';
            $text .= ( !empty( $instance['fax'] ) ) ? '<li>' . $fax_image . '<div class="info-container"><strong>' . __( 'Fax', 'yit' ) . ':</strong> ' . do_shortcode( $instance['fax'] ) . '</div></li>' : '';
            $text .= ( !empty( $instance['email'] ) ) ? '<li>' . $email_image . '<div class="info-container"><strong>' . __( 'Email', 'yit' ) . ':</strong> ' . do_shortcode( $instance['email'] ) . '</div></li>' : '';
            $text .= '  </ul>';
            $text .= '</div>';

            echo $text . $after_widget;
        }

        /**
         * update function.
         *
         * @see WP_Widget->update
         * @access public
         * @param array $new_instance
         * @param array $old_instance
         * @return array
         */
        function update( $new_instance, $old_instance )
        {
            $instance = $old_instance;

            $instance['title'] = strip_tags( $new_instance['title'] );

            $instance['subtitle'] = strip_tags( $new_instance['subtitle'] );

            $instance['phone'] = str_replace( '"', "'", $new_instance['phone'] );

            $instance['phone_image'] = $new_instance['phone_image'];

            $instance['mobile'] = str_replace( '"', "'", $new_instance['mobile'] );

            $instance['mobile_image'] = $new_instance['mobile_image'];

            $instance['email'] = str_replace( '"', "'", $new_instance['email'] );

            $instance['email_image'] = $new_instance['email_image'];

            $instance['address'] = str_replace( '"', "'", $new_instance['address'] );

            $instance['address_image'] = $new_instance['address_image'];

            $instance['fax'] = str_replace( '"', "'", $new_instance['fax'] );

            $instance['fax_image'] = $new_instance['fax_image'];

            return $instance;
        }

    }
endif;