<?php
/*
 * This file belongs to the YIT Framework.
 *
 * This source file is subject to the GNU GENERAL PUBLIC LICENSE (GPL 3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * http://www.gnu.org/licenses/gpl-3.0.txt
 */

$to_active_plugins  = $this->get_to_active_plugins();
$activated_plugins  = $this->get_activated_plugins();
$no_active_plugins  = $this->get_no_active_licence_key();
$expired_plugins    = isset( $no_active_plugins[ '106' ] ) ? $no_active_plugins[ '106' ] : array();
$banned_plugins     = isset( $no_active_plugins[ '107' ] ) ? $no_active_plugins[ '107' ] : array();

?>

<div class="yit-container plugin-licence-activation">
    <h2><?php _e( 'Plugin Licence Activation', 'yit' ) ?></h2>

    <div class="licence-check-section">
        <form method="post" id="licence-check-update" action="<?php echo admin_url( 'admin-ajax.php' ) ?>">
            <span class="licence-label" style="display: block;"><?php _e( 'Have you updated your licenses? Have you asked for an extension? Update information concerning your products.', 'yit' ); ?></span>
            <input type="hidden" name="action" value="update_licence_information" />
            <input type="submit" name="submit" value="<?php _e( 'Update licence information', 'yit' ) ?>" class="button-licence licence-check" />
            <div class="spinner"></div>
        </form>
    </div>

    <!-- To Active Plugins -->


    <?php if( ! empty( $to_active_plugins ) ) : ?>
        <h3 class="to-active">
            <?php _e( 'To Active', 'yit' ) ?>
            <span class="spinner"></span>
        </h3>
        <div class="to-active-wrapper">
            <?php foreach( $to_active_plugins as $init => $info ) : ?>
                <form class="to-active-form" method="post" id="<?php echo $info['product_id'] ?>" action="<?php echo admin_url( 'admin-ajax.php' ) ?>">
                    <table class="to-active-table">
                        <tbody>
                            <tr class="plugin-row">
                                <td class="plugin-name">
                                    <?php echo $info['Name'] ?>
                                </td>
                                <td>
                                    <input type="email" name="email" placeholder="Your email on Yithemes.com" value="" class="user-email" />
                                </td>
                                <td>
                                    <input type="text" name="licence_key" placeholder="Licence Key" value="" class="licence-key" />
                                </td>
                                <td class="activate-button">
                                    <input type="submit" name="submit" value="<?php _e( 'Activate', 'yit' )?>" class="button-licence licence-activation" data-formid="<?php echo $info['product_id'] ?>"/>
                                </td>
                            </tr>
                            <input type="hidden" name="action" value="activate" />
                            <input type="hidden" name="plugin_init" value="<?php echo $init ?>" />
                        </tbody>
                    </table>
                    <div class="spinner"></div>
                    <div class="message-wrapper">
                        <span class="message arrow-left"></span>
                    </div>
                </form>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <!-- Activated Plugins -->

    <?php if( ! empty( $activated_plugins ) ) : ?>
        <h3><?php _e( 'Activated', 'yit' ) ?></h3>
        <table class="expired-table">
            <thead>
                <tr>
                    <th><?php _e( 'Plugin Name', 'yit' ) ?></th>
                    <th><?php _e( 'Email', 'yit' ) ?></th>
                    <th><?php _e( 'Licence Key', 'yit' ) ?></th>
                    <th><?php _e( 'Expires', 'yit' ) ?></th>
                    <th><?php _e( 'Remaining', 'yit' ) ?></th>
                    <th><?php _e( 'Renew', 'yit' ) ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach( $activated_plugins as $init => $info ) : ?>
                    <tr>
                        <td class="plugin-name"><?php echo $info['Name'] ?></td>
                        <td class="plugin-licence-email"><?php echo $info['licence']['email'] ?></td>
                        <td class="plugin-licence-key"><?php echo $info['licence']['licence_key'] ?></td>
                        <td class="plugin-licence-expires"><?php echo date("F j, Y", $info['licence']['licence_expires'] ); ?></td>
                        <td class="plugin-licence-remaining">
                            <?php printf( __( '%1s out of %2s', 'yit' ), $info['licence']['activation_remaining'], $info['licence']['activation_limit']  ); ?>
                        </td>
                        <td><a class="button-licence licence-renew" href="<?php echo $this->get_renewing_uri( $info['licence']['licence_key'] ) ?>" target="_blank"><?php _e( 'Renew', 'yit' ) ?></a></td>
                    </tr>
                <?php endforeach; ?>
        </tbody>
    <?php endif;?>

     <!-- Banned Plugins -->

    <?php if( ! empty( $banned_plugins ) ) : ?>
        <h3><?php _e( 'Banned', 'yit' ) ?></h3>
        <table class="expired-table">
            <thead>
                <tr>
                    <th><?php _e( 'Plugin Name', 'yit' ) ?></th>
                    <th><?php _e( 'Email', 'yit' ) ?></th>
                    <th><?php _e( 'Licence Key', 'yit' ) ?></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach( $banned_plugins as $init => $info ) : ?>
                    <tr>
                        <td class="plugin-name"><?php echo $info['Name'] ?></td>
                        <td class="plugin-licence-email"><?php echo $info['licence']['email'] ?></td>
                        <td class="plugin-licence-key"><?php echo $info['licence']['licence_key'] ?></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif;?>

    <!-- Expired Plugins -->

    <?php if( ! empty( $expired_plugins ) ) : ?>
        <h3><?php _e( 'Expired', 'yit' ) ?></h3>
        <table class="expired-table">
            <thead>
                <tr>
                    <th><?php _e( 'Plugin Name', 'yit' ) ?></th>
                    <th><?php _e( 'Email', 'yit' ) ?></th>
                    <th><?php _e( 'Licence Key', 'yit' ) ?></th>
                    <th><?php _e( 'Expires', 'yit' ) ?></th>
                    <th><?php _e( 'Renew', 'yit' ) ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach( $expired_plugins as $init => $info ) : ?>
                    <tr>
                        <td class="plugin-name"><?php echo $info['Name'] ?></td>
                        <td class="plugin-licence-email"><?php echo $info['licence']['email'] ?></td>
                        <td class="plugin-licence-key"><?php echo $info['licence']['licence_key'] ?></td>
                        <td class="plugin-licence-expires"><?php echo date("F j, Y", $info['licence']['licence_expires'] ); ?></td>
                        <td><a class="button-licence licence-renew" href="<?php echo $this->get_renewing_uri( $info['licence']['licence_key'] ) ?>" target="_blank"><?php _e( 'Renew', 'yit' ) ?></a></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif;?>
</div>