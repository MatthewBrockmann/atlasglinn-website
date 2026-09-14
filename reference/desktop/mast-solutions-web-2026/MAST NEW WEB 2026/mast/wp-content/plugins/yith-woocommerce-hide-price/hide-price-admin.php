<?php
/**
 * Admin class
 *
 * @author Your Inspiration Themes
 * @package YITH WooCommerce Hide Price
 * @version 1.1.0
 */

if( !class_exists( 'YITH_Hide_Price_Admin' ) ) {
	/**
	 * Admin class.
	 * The class manage all the admin behaviors.
	 *
	 * @since 1.0.0
	 */
	class YITH_Hide_Price_Admin {
		/**
		 * Plugin options
		 *
		 * @var array
		 * @access public
		 * @since 1.0.0
		 */
		public $options = array();

		/**
		 * Plugin version
		 *
		 * @var string
		 * @since 1.0.0
		 */
		public $version;

		/**
		 * Various links
		 *
		 * @var string
		 * @access public
		 * @since 1.0.0
		 */
		public $banner_url = 'http://cdn.yithemes.com/plugins/yith_hideprice.php?url';
		public $banner_img = 'http://cdn.yithemes.com/plugins/yith_hideprice.php';
		public $doc_url    = 'http://yithemes.com/docs-plugins/yith_hideprice/';

		/**
		 * Constructor
		 *
		 * @access public
		 * @since 1.0.0
		 */
		public function __construct() {
			$this->options = $this->_initOptions();
			$this->version = '1.1.0';

			//Actions
			add_filter( 'plugin_action_links_' . plugin_basename( dirname(__FILE__) . '/hide-price.php' ), array( $this, 'action_links' ) );

			add_action( 'woocommerce_settings_tabs_yith_hide_price', array( $this, 'print_plugin_options' ) );
			add_action( 'woocommerce_update_options_yith_hide_price', array( $this, 'update_options' ) );
			add_action( 'woocommerce_admin_field_banner', array( $this, 'admin_fields_banner' ) );

			//Filters
			add_filter( 'woocommerce_settings_tabs_array', array( $this, 'add_tab_woocommerce' ), 30 );

			//Apply filters
			$this->banner_url = apply_filters('yith_hide_price_banner_url', $this->banner_url);
		}


		/**
		 * Init method:
		 *  - default options
		 *
		 * @access public
		 * @since 1.0.0
		 */
		public function init() {
			$this->_default_options();
		}


		/**
		 * Update plugin options.
		 *
		 * @return void
		 * @since 1.0.0
		 */
		public function update_options() {
			foreach( $this->options as $option ) {
				woocommerce_update_options( $option );
			}
		}


		/**
		 * Add Hide Prices's tab to Woocommerce -> Settings page
		 *
		 * @access public
		 * @param array $tabs
		 *
		 * @return array
		 */
		public function add_tab_woocommerce($tabs) {
			$tabs['yith_hide_price'] = __('Hide Price', 'yit');

			return $tabs;
		}



		/**
		 * Print all plugin options.
		 *
		 * @return void
		 * @since 1.0.0
		 */
		public function print_plugin_options() {
			$links = apply_filters( 'yith_hide_price_tab_links', array(
				'<a href="#yith_hide_price_general">' . __( 'General Settings', 'yit' ) . '</a>'
			) );

			$this->_printBanner();
			?>

			<div class="subsubsub_section">
				<ul class="subsubsub">
					<li>
						<?php echo implode( ' | </li><li>', $links ) ?>
					</li>
				</ul>
				<br class="clear" />

				<?php
				$option_theme = apply_filters('yith_hide_price_options_theme_plugin', $this->options );
				foreach( $option_theme as $id => $tab ) : ?>
				<!-- tab #<?php echo $id ?> -->
				<div class="section" id="yith_hide_price_<?php echo $id ?>">
					<?php woocommerce_admin_fields( $option_theme[$id] ) ?>
				</div>
				<?php endforeach ?>
			</div>
			<?php
		}


		/**
		 * Initialize the options
		 *
		 * @access protected
		 * @return array
		 * @since 1.0.0
		 */
		protected function _initOptions() {
			$options = array(
				'general' => array(
					array(
						'name' => __( 'General Settings', 'yit' ),
						'type' => 'title',
						'desc' => '',
						'id' => 'yith_hide_price_general'
					),

					array(
						'name' => __( 'Enable YITH Hide Price', 'yit' ),
						'desc' => __( 'Enable the plugin to hide prices and "add to cart" to unregistered users.', 'yit' ),
						'id'   => 'yith_hide_price_enable_plugin',
						'std'  => 1,
						'default' => 1,
						'type' => 'checkbox'
					),

					array( 'type' => 'sectionend', 'id' => 'yith_hide_price_general_end' )
				),
				'link' => array(
					array(
						'name' => __( 'Link Text', 'yit' ),
						'type' => 'title',
						'desc' => '',
						'id' => 'yith_hide_price_link'
					),

					array(
						'name' => __( 'The text inside the link', 'yit' ),
						'desc' => __( 'The text inside the LOGIN link. This link will bring users to the login page.', 'yit' ),
						'id'   => 'yith_hide_price_link_text',
						'std'  => 'Login',
						'default' => 'Login',
						'type' => 'text'
					),

					array( 'type' => 'sectionend', 'id' => 'yith_hide_price_link_end' )
				),
				'message' => array(
					array(
						'name' => __( 'Message Settings', 'yit' ),
						'type' => 'title',
						'desc' => '',
						'id' => 'yith_hide_price_message'
					),

					array(
						'name' => __( 'Message text', 'yit' ),
						'desc' => __( 'The message to show when the price is hidden. The LOGIN link is automaticaly added', 'yit' ),
						'id'   => 'yith_hide_price_text',
						'std'  => 'to see price',
						'default' => 'to see price',
						'type' => 'text',
					),

					array( 'type' => 'sectionend', 'id' => 'yith_hide_price_message_end' )
				),
				'color' => array(
					array(
						'name' => __( 'Color Settings', 'yit' ),
						'type' => 'title',
						'desc' => '',
						'id' => 'yith_hide_price_color'
					),

					array(
						'name' => __( 'Set color', 'yit' ),
						'desc' => __( 'Change the color for the message and the link. Leave blank to use your default theme style', 'yit' ),
						'id'   => 'yith_hide_price_change_color',
						'std'  => '',
						'default'  => '',
						'type' => 'color'
					),

					array( 'type' => 'sectionend', 'id' => 'yith_hide_price_color_end' )
				)
			);

			return apply_filters('yith_hide_price_tab_options', $options);
		}


		/**
		 * Default options
		 *
		 * Sets up the default options used on the settings page
		 *
		 * @access protected
		 * @return void
		 * @since 1.0.0
		 */
		protected function _default_options() {
			foreach ($this->options as $section) {
				foreach ( $section as $value ) {
					if ( isset( $value['std'] ) && isset( $value['id'] ) ) {
						add_option($value['id'], $value['std']);
					}
				}
			}
		}




		/**
		 * Save the admin field: slider
		 *
		 * @access public
		 * @param mixed $value
		 * @return void
		 * @since 1.0.0
		 */
		public function admin_update_option($value) {

            $wc_clean = function_exists('wc_clean') ? 'wc_clean' : 'woocommerce_clean';

			update_option( $value['id'], $wc_clean($_POST[$value['id']]) );
		}




		/**
		 * Print the banner
		 *
		 * @access protected
		 * @return void
		 * @since 1.0.0
		 */
		protected function _printBanner() {
		?>
			<div class="yith_banner">
				<a href="<?php echo $this->banner_url ?>" target="_blank">
					<img src="<?php echo $this->banner_img ?>" alt="" />
				</a>
			</div>
		<?php
		}


		/**
		 * action_links function.
		 *
		 * @access public
		 * @param mixed $links
		 * @return void
		 */
		public function action_links( $links ) {

            global $woocommerce;

            if ( version_compare( preg_replace( '/-beta-([0-9]+)/', '', $woocommerce->version ), '2.1', '<' ) ) {
                $wc_admin_page = 'woocommerce_settings';
            } else {
                $wc_admin_page = 'wc-settings';
            }

			$plugin_links = array(
				'<a href="' . admin_url( 'admin.php?page=' . $wc_admin_page . '&tab=yith_hide_price' ) . '">' . __( 'Settings', 'yit' ) . '</a>',
				'<a href="' . $this->doc_url . '">' . __( 'Docs', 'yit' ) . '</a>',
			);

			return array_merge( $plugin_links, $links );
		}
	}
}


global $yith_hide_price_admin;
$yith_hide_price_admin = new YITH_Hide_Price_Admin();