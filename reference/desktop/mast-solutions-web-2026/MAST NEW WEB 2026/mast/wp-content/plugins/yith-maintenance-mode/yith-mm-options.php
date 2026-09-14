<?php
/**
 * Main admin class
 *
 * @author Your Inspiration Themes
 * @package YITH Maintenance Mode
 * @version 1.1.2
 */

if ( !defined( 'YITH_MAINTENANCE' ) ) { exit; } // Exit if accessed directly

global $yith_maintenance_options;

$yith_maintenance_options = array(
    //tab general
    'general' => array(
        'label' => __('General', 'yit'),
        'sections' => array(
            'general' => array(
                'title' =>  __('General Settings', 'yit'),
                'description' => '',
                'fields' => array(
                    'yith_maintenance_enable' => array(
                        'title' => __('Enable Maintenance Mode', 'yit'),
                        'description' => __( 'Enable the splash page to lets users to know the blog is down for maintenance. (Default: Off) ', 'yit' ),
                        'type' => 'checkbox',
                        'std' => false
                    ),

                    'yith_maintenance_roles' => array(
                        'title' => __('Roles', 'yit'),
                        'description' => __( 'The user roles enabled to see the frontend. Check a role to enable it to show the website with maintenance mode active.', 'yit' ),
                        'type' => 'checkboxes',
                        'options' => yit_wp_roles(),
                        'std' => array( 'administrator' )
                    ),

                    'yith_maintenance_http_status' => array(
                        'title' => __('HTTP Status Code', 'yit'),
                        'description' => __( "You can set to send the HTTP status code, to say the status of the page and can tell to Google that this page isn't ready yet and cause your site not to be listed until this plugin is disabled.", 'yit' ),
                        'type' => 'select',
                        'options' => array(
                            200 => 'HTTP 200 - Ok',
                            301 => 'HTTP 301 - Redirect',
                            403 => 'HTTP 403 - Forbidden',
                            503 => 'HTTP 503 - Service Unavailable',
                        ),
                        'std' => 200
                    ),

                    'yith_maintenance_skin' => array(
                        'title' => __('Choose a skin for the maintenance mode', 'yit'),
                        'description' => __( "You can choose from 4 different skins to make your maintenance mode unique.", 'yit' ),
                        'type' => 'skin',
                        'path' => YITH_MAINTENANCE_URL . '/assets/images/',
                        'options' => apply_filters( 'yit_maintenance_mode_skin_options', array(
                            'skin1' => __('Skin 1', 'yit'),
                            'skin2' => __('Skin 2', 'yit'),
                            'skin3' => __('Skin 3', 'yit'),
                            'skin4' => __('Skin 4', 'yit'),
                        ) ),
                        'std' => apply_filters( 'yit_maintenance_mode_skin_std', 'skin1' )
                    ),

                    'yith_maintenance_message' => array(
                        'title' => __('Message', 'yit'),
                        'description' => __( 'The message displayed. You can also use HTML code.', 'yit' ),
                        'type' => 'textarea',
                        'std' => '<h3>' . __( 'OOPS! WE ARE NOT READY YET!', 'yit' ) . '</h3>
<p>' . __( "Hello there! We are not ready yet, but why don't you leave your email address  and we'll let you know  as soon as we're in business!", 'yit' ) . '</p>'
                    ),

                    'yith_maintenance_custom_style' => array(
                        'title' => 'Custom style',
                        'description' => __( 'Insert here your custom CSS style.', 'yit' ),
                        'type' => 'textarea',
                        'std' => '',
                        'in_skin' => false
                    ),

                    'yith_maintenance_mascotte' => array(
                        'title' => 'Mascotte',
                        'description' => __( 'If you want, you can set here a mascotte image to show above the main box, in the right side. This option is only available for skin 1.', 'yit' ),
                        'type' => 'upload',
                        'std' => YITH_MAINTENANCE_URL . 'assets/images/mascotte.png'
                    ),
                )
            ),
            'typography' => array(
                'title' =>  __('Typography', 'yit'),
                'description' => '',
                'fields' => array(
                    'yith_maintenance_title_font' => array(
                        'title' =>  __('Title font of message', 'yit'),
                        'description' => __('Choose the font type, size and color for the titles inside the message text.', 'yit'),
                        'type' => 'typography',
                        'std' => array(
                            'size' => 18,
                            'unit' => 'px',
                            'family' => 'Open Sans',
                            'style' => 'bold',
                            'color' => '#666666',
                        ),
                    ),
                    'yith_maintenance_paragraph_font' => array(
                        'title' =>  __('Paragraph font of message', 'yit'),
                        'description' => __('Choose the font type, size and color for the paragraphs inside the message text.', 'yit'),
                        'type' => 'typography',
                        'std' => array(
                            'size' => 13,
                            'unit' => 'px',
                            'family' => 'Open Sans',
                            'style' => 'regular',
                            'color' => '#666666',
                        ),
                    )
                )
            ),
            'colors' => array(
                'title' =>  __('Colors', 'yit'),
                'description' => '',
                'fields' => array(
                    'yith_maintenance_border_top' => array(
                        'title' =>  __('Border top color', 'yit'),
                        'description' => __('Choose the color for the big border top of the main box. This option is only available for skin 1.', 'yit'),
                        'type' => 'colorpicker',
                        'std' => '#fcd358',
                    )
                )
            ),
        )
    ),

    //tab background
    'background' => array(
        'label' => __('Background', 'yit'),
        'sections' => array(
            'background' => array(
                'title' =>  __('Background Settings', 'yit'),
                'description' => __('Customize the background of the page', 'yit'),
                'fields' => array(
                    'yith_maintenance_background_image' => array(
                        'title' =>  __('Background image', 'yit'),
                        'description' => __('Upload or choose from your media library the background image', 'yit'),
                        'type' => 'upload',
                        'std' => YITH_MAINTENANCE_URL . 'assets/images/bg-pattern.png',
                    ),
                    'yith_maintenance_background_color' => array(
                        'title' =>  __('Background Color', 'yit'),
                        'description' => __('Choose a background color', 'yit'),
                        'type' => 'colorpicker',
                        'std' => '',
                    ),
                    'yith_maintenance_background_repeat' => array(
                        'title' =>  __('Background Repeat', 'yit'),
                        'description' => __( 'Select the repeat mode for the background image.', 'yit' ),
                        'type' => 'select',
                        'std' => apply_filters( 'yith_maintenance_background_repeat_std', 'repeat' ),
                        'options' => array(
                            'repeat' => __( 'Repeat', 'yit' ),
                            'repeat-x' => __( 'Repeat Horizontally', 'yit' ),
                            'repeat-y' => __( 'Repeat Vertically', 'yit' ),
                            'no-repeat' => __( 'No Repeat', 'yit' ),
                        )
                    ),
                    'yith_maintenance_background_position' => array(
                        'title' =>  __('Background Position', 'yit'),
                        'description' =>  __( 'Select the position for the background image.', 'yit' ),
                        'type' => 'select',
                        'options' => array(
                            'center' => __( 'Center', 'yit' ),
                            'top left' => __( 'Top left', 'yit' ),
                            'top center' => __( 'Top center', 'yit' ),
                            'top right' => __( 'Top right', 'yit' ),
                            'bottom left' => __( 'Bottom left', 'yit' ),
                            'bottom center' => __( 'Bottom center', 'yit' ),
                            'bottom right' => __( 'Bottom right', 'yit' ),
                        ),
                        'std' => apply_filters( 'yith_maintenance_background_position_std', 'top left' )
                    ),
                    'yith_maintenance_background_attachment' => array(
                        'title' =>  __('Background Attachment', 'yit'),
                        'description' => __( 'Select the attachment for the background image.', 'yit' ),
                        'type' => 'select',
                        'options' => array(
                            'scroll' => __( 'Scroll', 'yit' ),
                            'fixed' => __( 'Fixed', 'yit' ),
                        ),
                        'std' => apply_filters( 'yith_maintenance_background_attachment_std', 'scroll' )
                    )
                )
            )
        )
    ),

    //tab logo
    'logo' => array(
        'label' => __('Logo', 'yit'),
        'sections' => array(
            'logo' => array(
                'title' =>  __('Logo Settings', 'yit'),
                'description' => __('Customize the logo', 'yit'),
                'fields' => array(
                    'yith_maintenance_logo_image' => array(
                        'title' =>  __('Logo image', 'yit'),
                        'description' => __('Upload or choose from your media library the logo image', 'yit'),
                        'type' => 'upload',
                        'std' => YITH_MAINTENANCE_URL . 'assets/images/logo.png',
                    ),
                    'yith_maintenance_logo_tagline' => array(
                        'title' =>  __('Logo tagline', 'yit'),
                        'description' => __('Set the tagline to show below the logo image', 'yit'),
                        'type' => 'text',
                        'std' => '',
                    ),
                    'yith_maintenance_logo_tagline_font' => array(
                        'title' =>  __('Logo tagline font', 'yit'),
                        'description' => __('Choose the font type, size and color for the tagline text.', 'yit'),
                        'type' => 'typography',
                        'std' => array(
                            'size' => 15,
                            'unit' => 'px',
                            'family' => 'Open Sans',
                            'style' => 'regular',
                            'color' => '#999999',
                        ),
                    )
                )
            )
        )
    ),

    //tab container
    'newsletter' => array(
        'label' => __('Newsletter', 'yit'),
        'sections' => array(
            'newsletter' => array(
                'title' =>  __('Newsletter', 'yit'),
                'description' => __('Add a newsletter form in your maintenance mode page.', 'yit'),
                'fields' => array(
                    'yith_maintenance_enable_newsletter_form' => array(
                        'title' =>  __('Enable Newsletter form', 'yit'),
                        'description' => __('Choose if you want to enable the newsletter form in the maintenance mode page.', 'yit'),
                        'type' => 'checkbox',
                        'std' => true,

                    ),
                    'yith_maintenance_newsletter_email_font' => array(
                        'title' =>  __('Newsletter Email Font', 'yit'),
                        'description' => __('Choose the font type, size and color for the email input field.', 'yit'),
                        'type' => 'typography',
                        'std' => array(
                            'size' => 12,
                            'unit' => 'px',
                            'family' => 'Open Sans',
                            'style' => 'bold',
                            'color' => '#a3a3a3',
                        ),

                    ),
                    'yith_maintenance_newsletter_submit_font' => array(
                        'title' =>  __('Newsletter Submit Font', 'yit'),
                        'description' => __('Choose the font type, size and color for the email submit.', 'yit'),
                        'type' => 'typography',
                        'std' => array(
                            'size' => 16,
                            'unit' => 'px',
                            'family' => 'Open Sans',
                            'style' => 'extra-bold',
                            'color' => '#fff',
                        ),

                    ),
                    'yith_maintenance_newsletter_submit_background' => array(
                        'title' =>  __('Newsletter submit background', 'yit'),
                        'description' => __('The submit button background.', 'yit'),
                        'type' => 'colorpicker',
                        'std' => '#617291',

                    ),
                    'yith_maintenance_newsletter_submit_background_hover' => array(
                        'title' =>  __('Newsletter submit hover background', 'yit'),
                        'description' => __('The submit button hover background.', 'yit'),
                        'type' => 'colorpicker',
                        'std' => '#3c5072',

                    ),
                    'yith_maintenance_newsletter_title' => array(
                        'title' =>  __('Title', 'yit'),
                        'description' => __('The title displayed above the newsletter form.', 'yit'),
                        'type' => 'text',
                        'std' => '',

                    )
                )
            ),
            'newsletter_configuration' => array(
                'title' =>  __('Form configuration', 'yit'),
                'description' => __('Configure the form and each field, to integrate the newsletter features of an external service.', 'yit'),
                'fields' => array(
                    'yith_maintenance_newsletter_action' => array(
                        'title' =>  __('Action URL', 'yit'),
                        'description' => __('Set the action url of the form.', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false
                    ),
                    'yith_maintenance_newsletter_method' => array(
                        'title' =>  __('Form method', 'yit'),
                        'description' => __('Set the method for the form request.', 'yit'),
                        'type' => 'select',
                        'options' => array(
                            'POST' => 'POST',
                            'GET'  => 'GET',
                        ),
                        'std' => 'POST',
                        'in_skin' => false
                    ),
                    'yith_maintenance_newsletter_email_label' => array(
                        'title' =>  __('"Email" field label', 'yit'),
                        'description' => __('The label for the email field', 'yit'),
                        'type' => 'text',
                        'std' => 'Enter your email address',

                    ),
                    'yith_maintenance_newsletter_email_name' => array(
                        'title' =>  __('"Email" field name', 'yit'),
                        'description' => __('The "name" attribute for the email field', 'yit'),
                        'type' => 'text',
                        'std' => 'email',

                    ),
                    'yith_maintenance_newsletter_submit_label' => array(
                        'title' =>  __('Submit button label', 'yit'),
                        'description' => __('The label for the submit button', 'yit'),
                        'type' => 'text',
                        'std' => __( 'NOTIFY ME', 'yit' ),

                    ),
                    'yith_maintenance_newsletter_hidden_fields' => array(
                        'title' =>  __('Newsletter Hidden fields', 'yit'),
                        'description' => __('Set the hidden fields to include in the form. Use the form: field1=value1&field2=value2&field3=value3', 'yit'),
                        'type' => 'text',
                        'std' => '',

                    )
                )
            )
        )
    ),

    //tab logo
    'socials' => array(
        'label' => __('Socials', 'yit'),
        'sections' => array(
            'logo' => array(
                'title' =>  __('Set the socials', 'yit'),
                'description' => __( "You can set here the url of your social accounts (you can leave empty if you don't want to show the social icon)", 'yit' ),
                'fields' => array(
                    'yith_maintenance_socials_facebook' => array(
                        'title' =>  __('Facebook', 'yit'),
                        'description' => __('Set the URL of your facebook profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_twitter' => array(
                        'title' =>  __('Twitter', 'yit'),
                        'description' => __('Set the URL of your twitter profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_gplus' => array(
                        'title' =>  __('Google+', 'yit'),
                        'description' => __('Set the URL of your Google+ profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_youtube' => array(
                        'title' =>  __('Youtube', 'yit'),
                        'description' => __('Set the URL of your youtube profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_rss' => array(
                        'title' =>  __('RSS', 'yit'),
                        'description' => __('Set the URL of your RSS feed', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_skype' => array(
                        'title' =>  __('Skype', 'yit'),
                        'description' => __('Set the username of your skype account', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_email' => array(
                        'title' =>  __('Email', 'yit'),
                        'description' => __('Write here your email address', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_behance' => array(
                        'title' =>  __('Behance', 'yit'),
                        'description' => __('Set the URL of your Behance profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_dribble' => array(
                        'title' =>  __('Dribble', 'yit'),
                        'description' => __('Set the URL of your dribble profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_flickr' => array(
                        'title' =>  __('FlickR', 'yit'),
                        'description' => __('Set the URL of your Flickr profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_instagram' => array(
                        'title' =>  __('Instagram', 'yit'),
                        'description' => __('Set the URL of your instagram profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_pinterest' => array(
                        'title' =>  __('Pinterest', 'yit'),
                        'description' => __('Set the URL of your Pinterest profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_tumblr' => array(
                        'title' =>  __('Tumblr', 'yit'),
                        'description' => __('Set the URL of your Tumblr profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                    'yith_maintenance_socials_linkedin' => array(
                        'title' =>  __('LinkedIn', 'yit'),
                        'description' => __('Set the URL of your LinkedIn profile', 'yit'),
                        'type' => 'text',
                        'std' => '',
                        'in_skin' => false,
                    ),
                )
            )
        )
    ),
);
