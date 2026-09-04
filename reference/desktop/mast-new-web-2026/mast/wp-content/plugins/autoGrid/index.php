<?php 
  /**
   * @package Auto Grid Responsive Gallery by David Blanco
   * @version 2.3
   */
  /*
  Plugin Name: Auto Grid Responsive Gallery
  Plugin URI: http://codecanyon.net/user/davidbo90/portfolio
  Description: This is a plugin that scans a folder in your server and its subfolders containing images. The subfolders will be the categories that will appear at the top, and the plugin will make a grid responsive gallery with the images.
  Author: David Blanco
  Version: 2.3
  Author URI: http://codecanyon.net/user/davidbo90
  */

  /* --------------------- OPTIONS PAGE ------------------ */  


  class AGRG_Options{

      public $options;

      public function __construct(){
          //delete_option('agrg_plugin_options');
          $this->options = get_option('agrg_plugin_options');
          $this->register_settings_and_fields();
      }

      public function add_menu_page(){
          add_options_page('Auto Grid Responsive Gallery Options', 'Auto Grid Options', 'administrator', __FILE__, array('AGRG_Options', 'display_options_page'));
      }

      public function display_options_page(){
          ?>
          
          <div class="wrap">
            <?php screen_icon(); ?>
            <h2>Auto Grid Responsive Gallery Default Options</h2>

            <form action="options.php" method="post" enctype="multipart/form-data">
                <?php settings_fields('agrg_plugin_options'); ?>

                <?php do_settings_sections(__FILE__); ?>

                <p class="submit">
                    <input name="submit" type="submit" class="button-primary" value="Save Changes" />
                </p>

            </form>

          </div>
          
          <?php
      }

      public function register_settings_and_fields(){

          register_setting('agrg_plugin_options', 'agrg_plugin_options');//3rd param = optional callback
          add_settings_section('agrg_main_section', 'Main Settings', array($this, 'agrg_main_section_cb'), __FILE__);// id, title, cb, which page?

          add_settings_field('agrg_directory', 'Directory of the Folder ', array($this, 'agrg_directory_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lazyLoad', 'Lazy Load Feature? ', array($this, 'agrg_lazyLoad_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_catOrder', 'Categories Order ', array($this, 'agrg_catOrder_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_imagesOrder', 'Images Order ', array($this, 'agrg_imagesOrder_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_orderInAll', 'Images Order In All', array($this, 'agrg_orderInAll_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_navBar', 'Show Navigation Bar? ', array($this, 'agrg_navBar_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_smartNavBar', 'Smart Navigation Bar? ', array($this, 'agrg_smartNavBar_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_imagesToLoadStart', 'Images To Load At Startup ', array($this, 'agrg_imagesToLoadStart_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_imagesToLoad', 'Images To Load ', array($this, 'agrg_imagesToLoad_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_aleatory', 'Aleatory Images From Categories ', array($this, 'agrg_aleatory_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_horizontalSpace', 'Horizontal Space Between Thumbnails', array($this, 'agrg_horizontalSpace_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_verticalSpace', 'Vertical Space Between Thumbnails', array($this, 'agrg_verticalSpace_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_columnWidth', 'Column Width', array($this, 'agrg_columnWidth_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_columns', 'Number of Columns', array($this, 'agrg_columns_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_columnMinWidth', 'Minimum Width of Each Column (px)', array($this, 'agrg_columnMinWidth_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_isAnimated', 'Animated Effects for the Grid?', array($this, 'agrg_isAnimated_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_caption', 'Show the Captions of the Images?', array($this, 'agrg_caption_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_captionCat', 'Show the Category of the Captions?', array($this, 'agrg_captionCat_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_captionType', 'The Effect of the Caption', array($this, 'agrg_captionType_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBox', 'Show the Lightbox?', array($this, 'agrg_lightBox_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxKeyboard', 'Lightbox Keyboard Navigation?', array($this, 'agrg_lightBoxKeyboard_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxSpeed', 'Lightbox Speed Effect (ms)', array($this, 'agrg_lightBoxSpeed_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxZoom', 'Lightbox Zoom Animation?', array($this, 'agrg_lightBoxZoom_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxText', 'Lightbox Text?', array($this, 'agrg_lightBoxText_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxPlay', 'Lightbox Play Button?', array($this, 'agrg_lightBoxPlay_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxAutoPlay', 'Lightbox Auto Play?', array($this, 'agrg_lightBoxAutoPlay_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxPlayInterval', 'Lightbox Play Interval (ms)', array($this, 'agrg_lightBoxPlayInterval_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxShowTimer', 'Lightbox Show Timer?', array($this, 'agrg_lightBoxShowTimer_setting'), __FILE__, 'agrg_main_section');
          add_settings_field('agrg_lightBoxStopPlay', 'Stop Play When Lightbox Closes?', array($this, 'agrg_lightBoxStopPlay_setting'), __FILE__, 'agrg_main_section');
      }   

      public function agrg_main_section_cb(){
          //Optional
      }

      /*
          INPUTS
      */

      public function agrg_directory_setting(){
          $op = "gallery";
          if(!empty($this->options['agrg_directory'])){
              $op = $this->options['agrg_directory'];
          }

          $parseURL = parse_url(plugin_dir_url( __FILE__ ));
          $path = $parseURL['path'];

          echo $path."<input name='agrg_plugin_options[agrg_directory]' type='text' value='{$op}' style='width:200px;' />";
      }

      public function agrg_lazyLoad_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lazyLoad'])){
              $op = $this->options['agrg_lazyLoad'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lazyLoad]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_catOrder_setting(){
          $op = 'byName';
          if(!empty($this->options['agrg_catOrder'])){
              $op = $this->options['agrg_catOrder'];
          }

          $byDate         = "";
          $byDateReverse  = "";
          $byName         = "";
          $byNameReverse  = "";
          $random         = "";


          if($op == 'byDate'){
            $byDate = "selected='selected'";
          }else if($op == 'byDateReverse'){
            $byDateReverse = "selected='selected'";
          }else if($op == 'byName'){
            $byName = "selected='selected'";
          }else if($op == 'byNameReverse'){
            $byNameReverse = "selected='selected'";
          }else if($op == 'random'){
            $random = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_catOrder]'>";
            echo "<option $byDate value='byDate'>By Date</option>";
            echo "<option $byDateReverse value='byDateReverse'>By Date Reverse</option>";
            echo "<option $byName value='byName'>By Name</option>";
            echo "<option $byNameReverse value='byNameReverse'>By Name Reverse</option>";
            echo "<option $random value='random'>Randomly</option>";
          echo "</select>";
      }

      public function agrg_imagesOrder_setting(){
          $op = 'byName';
          if(!empty($this->options['agrg_imagesOrder'])){
              $op = $this->options['agrg_imagesOrder'];
          }

          $byDate         = "";
          $byDateReverse  = "";
          $byName         = "";
          $byNameReverse  = "";
          $random         = "";


          if($op == 'byDate'){
            $byDate = "selected='selected'";
          }else if($op == 'byDateReverse'){
            $byDateReverse = "selected='selected'";
          }else if($op == 'byName'){
            $byName = "selected='selected'";
          }else if($op == 'byNameReverse'){
            $byNameReverse = "selected='selected'";
          }else if($op == 'random'){
            $random = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_imagesOrder]'>";
            echo "<option $byDate value='byDate'>By Date</option>";
            echo "<option $byDateReverse value='byDateReverse'>By Date Reverse</option>";
            echo "<option $byName value='byName'>By Name</option>";
            echo "<option $byNameReverse value='byNameReverse'>By Name Reverse</option>";
            echo "<option $random value='random'>Randomly</option>";
          echo "</select>";
      }

      public function agrg_orderInAll_setting(){
          $op = 'false';
          if(!empty($this->options['agrg_orderInAll'])){
              $op = $this->options['agrg_orderInAll'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_orderInAll]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_navBar_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_navBar'])){
              $op = $this->options['agrg_navBar'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_navBar]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_smartNavBar_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_smartNavBar'])){
              $op = $this->options['agrg_smartNavBar'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_smartNavBar]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_imagesToLoadStart_setting(){
          $op = "15";
          if(!empty($this->options['agrg_imagesToLoadStart'])){
              $op = $this->options['agrg_imagesToLoadStart'];
          }

          echo "<input name='agrg_plugin_options[agrg_imagesToLoadStart]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_imagesToLoad_setting(){
          $op = "5";
          if(!empty($this->options['agrg_imagesToLoad'])){
              $op = $this->options['agrg_imagesToLoad'];
          }

          echo "<input name='agrg_plugin_options[agrg_imagesToLoad]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_aleatory_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_aleatory'])){
              $op = $this->options['agrg_aleatory'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_aleatory]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_horizontalSpace_setting(){
          $op = "5";
          if(!empty($this->options['agrg_horizontalSpace'])){
              $op = $this->options['agrg_horizontalSpace'];
          }

          echo "<input name='agrg_plugin_options[agrg_horizontalSpace]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_verticalSpace_setting(){
          $op = "5";
          if(!empty($this->options['agrg_verticalSpace'])){
              $op = $this->options['agrg_verticalSpace'];
          }

          echo "<input name='agrg_plugin_options[agrg_verticalSpace]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_columnWidth_setting(){
          $op = "auto";
          if(!empty($this->options['agrg_columnWidth'])){
              $op = $this->options['agrg_columnWidth'];
          }

          echo "<input name='agrg_plugin_options[agrg_columnWidth]' type='text' value='{$op}' style='width:80px;' />";
      }

      public function agrg_columns_setting(){
          $op = "5";
          if(!empty($this->options['agrg_columns'])){
              $op = $this->options['agrg_columns'];
          }

          echo "<input name='agrg_plugin_options[agrg_columns]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_columnMinWidth_setting(){
          $op = "220";
          if(!empty($this->options['agrg_columnMinWidth'])){
              $op = $this->options['agrg_columnMinWidth'];
          }

          echo "<input name='agrg_plugin_options[agrg_columnMinWidth]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_isAnimated_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_isAnimated'])){
              $op = $this->options['agrg_isAnimated'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_isAnimated]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_caption_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_caption'])){
              $op = $this->options['agrg_caption'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_caption]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_captionCat_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_captionCat'])){
              $op = $this->options['agrg_captionCat'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_captionCat]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_captionType_setting(){
          $op = 'Grid';
          if(!empty($this->options['agrg_captionType'])){
              $op = $this->options['agrg_captionType'];
          }

          $grid           = "";
          $gridFade       = "";
          $classic         = "";


          if($op == 'grid'){
            $grid = "selected='selected'";
          }else if($op == 'grid-fade'){
            $gridFade = "selected='selected'";
          }else if($op == 'classic'){
            $classic = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_captionType]'>";
            echo "<option $grid value='grid'>Grid</option>";
            echo "<option $gridFade value='grid-fade'>Grid Fade</option>";
            echo "<option $classic value='classic'>Classic</option>";
          echo "</select>";
      }

      public function agrg_lightBox_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBox'])){
              $op = $this->options['agrg_lightBox'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBox]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxKeyboard_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBoxKeyboard'])){
              $op = $this->options['agrg_lightBoxKeyboard'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxKeyboard]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxSpeed_setting(){
          $op = "500";
          if(!empty($this->options['agrg_lightBoxSpeed'])){
              $op = $this->options['agrg_lightBoxSpeed'];
          }

          echo "<input name='agrg_plugin_options[agrg_lightBoxSpeed]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_lightBoxZoom_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBoxZoom'])){
              $op = $this->options['agrg_lightBoxZoom'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxZoom]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxText_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBoxText'])){
              $op = $this->options['agrg_lightBoxText'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxText]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxPlay_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBoxPlay'])){
              $op = $this->options['agrg_lightBoxPlay'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxPlay]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxAutoPlay_setting(){
          $op = 'false';
          if(!empty($this->options['agrg_lightBoxAutoPlay'])){
              $op = $this->options['agrg_lightBoxAutoPlay'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxAutoPlay]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxPlayInterval_setting(){
          $op = "4000";
          if(!empty($this->options['agrg_lightBoxPlayInterval'])){
              $op = $this->options['agrg_lightBoxPlayInterval'];
          }

          echo "<input name='agrg_plugin_options[agrg_lightBoxPlayInterval]' type='number' value='{$op}' style='width:80px;' />";
      }

      public function agrg_lightBoxShowTimer_setting(){
          $op = 'true';
          if(!empty($this->options['agrg_lightBoxShowTimer'])){
              $op = $this->options['agrg_lightBoxShowTimer'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxShowTimer]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }

      public function agrg_lightBoxStopPlay_setting(){
          $op = 'false';
          if(!empty($this->options['agrg_lightBoxStopPlay'])){
              $op = $this->options['agrg_lightBoxStopPlay'];
          }

          $no = "";
          if($op == 'false'){
            $no = "selected='selected'";
          }

          echo "<select name='agrg_plugin_options[agrg_lightBoxStopPlay]'>";
            echo "<option value='true'>Yes</option>";
            echo "<option value='false' $no>No</option>";
          echo "</select>";
      }



  }

  add_action('admin_menu', 'initOptionsAGRG');

  function initOptionsAGRG(){
      AGRG_Options::add_menu_page();
  }

  add_action('admin_init', 'initAdminAGRG');

  function initAdminAGRG(){
    
      new AGRG_Options();
  }

  

  /* 
  *
  *
  *
  *
  *
  -------------------------------------------- END OF OPTIONS PAGE --------------------------------------------
  *
  *
  *
  *
  *
  */

  /* --------------------- STYLE AND SCRIPTS ------------------ */  

  function AutoGridResponsiveGallery_scripts()  
  {  
       // Register the script like this for a plugin:  
      wp_register_script( 'agrg-script-rotate', plugins_url( '/js/rotate-patch.js', __FILE__ ), array( 'jquery' ) );  
      
      // For either a plugin or a theme, you can then enqueue the script:  
      wp_enqueue_script( 'agrg-script-rotate' );

      // Register the script like this for a plugin:  
      wp_register_script( 'agrg-script', plugins_url( '/js/autoGrid.min.js', __FILE__ ), array( 'jquery' ) );  
      
      // For either a plugin or a theme, you can then enqueue the script:  
      wp_enqueue_script( 'agrg-script' );  

      // Register the script like this for a plugin:  
      wp_register_script( 'agrg-script-init', plugins_url( 'autoGrid.js', __FILE__ ), array( 'jquery' ) );  
      
      // For either a plugin or a theme, you can then enqueue the script:  
      wp_enqueue_script( 'agrg-script-init' ); 

      //Pass default options to the script ----------------->
      $options = get_option('agrg_plugin_options');
      
      $lazyLoad   = true;
      if(!empty($options['agrg_lazyLoad'])){$lazyLoad = $options['agrg_lazyLoad']=='true'?true:false;}

      $catOrder   = "byName";
      if(!empty($options['agrg_catOrder'])){$catOrder = $options['agrg_catOrder'];}

      $imgOrder   = "byName";
      if(!empty($options['agrg_imagesOrder'])){$imgOrder = $options['agrg_imagesOrder'];}

      $orderInAll   = false;
      if(!empty($options['agrg_orderInAll'])){$orderInAll = $options['agrg_orderInAll']=='true'?true:false;}

      $showNavBar   = true;
      if(!empty($options['agrg_navBar'])){$showNavBar = $options['agrg_navBar']=='true'?true:false;}

      $smartNavBar   = true;
      if(!empty($options['agrg_smartNavBar'])){$smartNavBar = $options['agrg_smartNavBar']=='true'?true:false;}

      $imagesToLoadStart   = "15";
      if(!empty($options['agrg_imagesToLoadStart'])){$imagesToLoadStart = $options['agrg_imagesToLoadStart'];}

      $imagesToLoad   = "5";
      if(!empty($options['agrg_imagesToLoad'])){$imagesToLoad = $options['agrg_imagesToLoad'];}

      $aleatory   = true;
      if(!empty($options['agrg_aleatory'])){$aleatory = $options['agrg_aleatory']=='true'?true:false;}

      $horizontalSpace   = "5";
      if(!empty($options['agrg_horizontalSpace'])){$horizontalSpace = $options['agrg_horizontalSpace'];}

      $verticalSpace   = "5";
      if(!empty($options['agrg_verticalSpace'])){$verticalSpace = $options['agrg_verticalSpace'];}

      $columnWidth   = "auto";
      if(!empty($options['agrg_columnWidth'])){$columnWidth = $options['agrg_columnWidth'];}

      $columns   = "5";
      if(!empty($options['agrg_columns'])){$columns = $options['agrg_columns'];}

      $columnMinWidth   = "220";
      if(!empty($options['agrg_columnMinWidth'])){$columnMinWidth = $options['agrg_columnMinWidth'];}

      $isAnimated   = true;
      if(!empty($options['agrg_isAnimated'])){$isAnimated = $options['agrg_isAnimated']=='true'?true:false;}

      $caption   = true;
      if(!empty($options['agrg_caption'])){$caption = $options['agrg_caption']=='true'?true:false;}

      $captionCat   = true;
      if(!empty($options['agrg_captionCat'])){$captionCat = $options['agrg_captionCat']=='true'?true:false;}

      $captionType   = "grid";
      if(!empty($options['agrg_captionType'])){$captionType = $options['agrg_captionType'];}

      $lightbox   = true;
      if(!empty($options['agrg_lightBox'])){$lightbox = $options['agrg_lightBox']=='true'?true:false;}

      $lightboxKeyboardNav   = true;
      if(!empty($options['agrg_lightBoxKeyboard'])){$lightboxKeyboardNav = $options['agrg_lightBoxKeyboard']=='true'?true:false;}

      $lightBoxSpeedFx   = "500";
      if(!empty($options['agrg_lightBoxSpeed'])){$lightBoxSpeedFx = $options['agrg_lightBoxSpeed'];}

      $lightboxZoom   = true;
      if(!empty($options['agrg_lightBoxZoom'])){$lightboxZoom = $options['agrg_lightBoxZoom']=='true'?true:false;}

      $lightBoxText   = true;
      if(!empty($options['agrg_lightBoxText'])){$lightBoxText = $options['agrg_lightBoxText']=='true'?true:false;}

      $lightboxPlayBtn   = true;
      if(!empty($options['agrg_lightBoxPlay'])){$lightboxPlayBtn = $options['agrg_lightBoxPlay']=='true'?true:false;}

      $lightBoxAutoPlay   = false;
      if(!empty($options['agrg_lightBoxAutoPlay'])){$lightBoxAutoPlay = $options['agrg_lightBoxAutoPlay']=='true'?true:false;}

      $lightBoxPlayInterval   = "4000";
      if(!empty($options['agrg_lightBoxPlayInterval'])){$lightBoxPlayInterval = $options['agrg_lightBoxPlayInterval'];}

      $lightBoxShowTimer   = true;
      if(!empty($options['agrg_lightBoxShowTimer'])){$lightBoxShowTimer = $options['agrg_lightBoxShowTimer']=='true'?true:false;}

      $lightBoxStopPlayOnClose   = false;
      if(!empty($options['agrg_lightBoxStopPlay'])){$lightBoxStopPlayOnClose = $options['agrg_lightBoxStopPlay']=='true'?true:false;}

      wp_localize_script( 'agrg-script-init', 'agrg_vars', array( 'catOrder'          => $catOrder, 
                                                                  'lazyLoad'          => $lazyLoad,
                                                                  'imgOrder'          => $imgOrder,
                                                                  'orderInAll'       => $orderInAll,
                                                                  'showNavBar'        => $showNavBar,
                                                                  'smartNavBar'       => $smartNavBar,
                                                                  'imagesToLoadStart' => $imagesToLoadStart,
                                                                  'imagesToLoad'      => $imagesToLoad,
                                                                  'aleatory'          => $aleatory,
                                                                  'horizontalSpace'   => $horizontalSpace,
                                                                  'verticalSpace'     => $verticalSpace,
                                                                  'columnWidth'       => $columnWidth,
                                                                  'columns'           => $columns,
                                                                  'columnMinWidth'    => $columnMinWidth,
                                                                  'isAnimated'        => $isAnimated,
                                                                  'caption'           => $caption,
                                                                  'captionType'       => $captionType,
                                                                  'captionCat'        => $captionCat,
                                                                  'lightbox'          => $lightbox,
                                                                  'lightboxKeyboardNav' => $lightboxKeyboardNav,
                                                                  'lightBoxSpeedFx'   => $lightBoxSpeedFx,
                                                                  'lightboxZoom'      => $lightboxZoom,
                                                                  'lightBoxText'      => $lightBoxText,
                                                                  'lightboxPlayBtn'   => $lightboxPlayBtn,
                                                                  'lightBoxAutoPlay'  => $lightBoxAutoPlay,
                                                                  'lightBoxPlayInterval' => $lightBoxPlayInterval,
                                                                  'lightBoxShowTimer' => $lightBoxShowTimer,
                                                                  'lightBoxStopPlayOnClose' => $lightBoxStopPlayOnClose  ) );

      if($lazyLoad){
          // Register the script like this for a plugin:  
          wp_register_script( 'aamrg-script-waypoints', plugins_url( '/js/waypoints.min.js', __FILE__ ), array( 'jquery' ) );  
          
          // For either a plugin or a theme, you can then enqueue the script:  
          wp_enqueue_script( 'aamrg-script-waypoints' );
      }
  
  }  

  function AutoGridResponsiveGallery_styles()  
  {  
      //GRID STYLE
      wp_register_style( 'agrg-style', plugins_url( '/css/gridGallery.css', __FILE__ ), array(), '20120208', 'all' );  
      wp_enqueue_style( 'agrg-style' );  
  }  

  
  add_action( 'wp_enqueue_scripts', 'AutoGridResponsiveGallery_styles' );
  add_action( 'wp_enqueue_scripts', 'AutoGridResponsiveGallery_scripts' ); 

  /* --------------------- END STYLE AND SCRIPTS ------------------ */  


  /* --------------------- SHORTCODE ------------------ */  

  add_shortcode( 'autoGrid', 'auto_grid' );


  function auto_grid( $atts, $content = false ) {

      $options = get_option('agrg_plugin_options');

      $directory   = "gallery";
      if( !empty($options['agrg_directory']) ){$directory = $options['agrg_directory'];}
      if( !empty($atts['directory']) ){$directory = $atts['directory'];}

      $parseURL = parse_url(plugin_dir_url( __FILE__ ));
      $path = $parseURL['path'];

      $site = get_site_url();
      $site2 = str_replace("//", "@@", $site);
      $site3 = explode("/", $site2);
      $site4 = str_replace("@@", "//", $site3[0]);

      return "<div class='autoGridResponsiveGallery agrg_centered agrg_clearfix' data-directory='$directory' data-path='$path' data-site='$site4'></div>";

  }
?>