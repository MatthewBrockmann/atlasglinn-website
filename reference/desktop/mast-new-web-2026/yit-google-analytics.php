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

/**
 * YIT Google Analytics
 *
 * Manage Google Analytics in the YIT Framework
 *
 * @class      YIT_Google_Analytics
 * @package    Yitheme
 * @since      1.0
 * @author     Your Inspiration Themes
 */

class YIT_Google_Analytics{
    /**
     * @var string
     */
    public $version = YIT_SIDEBARS_VERSION;

    /**
     * @var string
     */
    public $plugin_url;

    /**
     * @var string
     */
    public $plugin_path;

    /**
     * @var string
     */
    public $plugin_assets_url;

    /**
     * @var string plugin option name
     */
    public $plugin_options = 'yit_google-analytics_options';

    /**
     * @var object The single instance of the class
     * @since 1.0
     */
    protected static $_instance = null;

    /**
     * @var object The single instance of the subpanel
     * @since 1.0
     */
    protected $_subpanel = null;

    /**
     * Main plugin Instance
     *
     * @static
     * @return object Main instance
     *
     * @since  1.0
     * @author Antonino Scarfì <antonino.scarfi@yithemes.com>
     */
    public static function instance() {
        if ( is_null( self::$_instance ) ) {
            self::$_instance = new self();
        }

        return self::$_instance;
    }

    /**
     * Constructor
     *
     * @since  1.0.0
     * @author Antonio La Rocca <antonio.larocca@yithemes.it>
     */
    public function __construct() {

        // set class attributes
        $this->plugin_url        = untrailingslashit( plugins_url( '/', __FILE__ ) );
        $this->plugin_path       = untrailingslashit( plugin_dir_path( __FILE__ ) );
        $this->plugin_assets_url = $this->plugin_url . '/assets';

        add_action( 'after_setup_theme'  , array( $this, 'add_panel' ) );

        add_action( 'wp_footer', array( $this, 'add_google_analytics') );
    }

    /**
     * Add Panel
     *
     * Add Google analytics SubPanel to YIT Plugins panel
     *
     * @return void
     * @since 1.0.0
     * @author Antonio La Rocca <antonio.larocca@yithemes.it>
    */
    public function add_panel(){
        if ( ! empty( $this->_subpanel ) ) {
            return;
        }

        $admin_tabs = array(
            'general'  => __( 'General', 'yit' ),
        );

        $args = array(
            'page'           => 'google-analytics',
            'label'        => __( 'YIT Google Analytics', 'yit' ),
            'admin-tabs'   => $admin_tabs,
            'plugin-url' => $this->plugin_url,
            'plugin-path' => $this->plugin_path,
            'options-path' => $this->plugin_path . '/plugin-options/google-analytics'
        );

        $this->_subpanel = new Yit_Plugin_SubPanel( $args );
    }

    /**
     * Add Google Analytics Script to Footer
     *
     * Add Google analytics script to footer in template
    */
    public function add_google_analytics(){
        $script = stripslashes_deep( $this->get_option( 'google-analytics-code' ) );
        if( $script !== FALSE && strcmp( $script, '' ) != 0 ):
        ?>
        <script>
            <?php echo $script ?>
        </script>
        <?php
        endif;
    }

    /**
     * Get the option with the specified id from the db
     *
     * @param $option string Option id
     *
     * @return string
     * @since 1.0.0
     * @author Antonio La Rocca <antonio.larocca@yithemes.it>
     */
    public function get_option($option){
        $options = get_option( $this->plugin_options );

        if ( isset( $options[$option] ) ) {
            return $options[$option];
        }
        else {
            return '';
        }
    }
}
/**
 * Main instance of plugin
 *
 * @return object
 * @since  1.0
 * @author Antonio La Rocca <antonio.larocca@yithemes.it>
 */
function YIT_Google_Analytics() {
    return YIT_Google_Analytics::instance();
}

/**
 * Instantiate Sidebar class
 *
 * @since  1.0
 * @author Antonio La Rocca <antonio.larocca@yithemes.it>
 */
YIT_Google_Analytics();