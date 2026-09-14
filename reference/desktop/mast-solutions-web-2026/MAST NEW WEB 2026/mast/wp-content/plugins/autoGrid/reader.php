<?php 

  //CONFIGURATION

  $imgTypes = array('jpeg', 'jpg', 'png', 'gif'); // The extensions of Images that the plugin will read
  $categoriesOrder    = $_GET['categoriesOrder']; //byDate, byDateReverse, byName, byNameReverse, random
  $imagesOrder      = $_GET['imagesOrder']; //byDate, byDateReverse, byName, byNameReverse, random

  
  function getFoldersList ($directory){
        global $categoriesOrder;
        if( !is_dir($directory)){//If the parameter is a directory if not then just return
          return array();
        }
        $results = array();
        $handler = opendir($directory);
        while ($file = readdir($handler)) {
          if ($file != "." && $file != ".." && $file != ".DS_Store" && is_dir($directory.'/'.$file) && $file != "thumbnails" ) {//If it is a folder
            $ctime = filemtime($directory .'/'. $file) . ',' . $file; //BRING THE DATE OF THE FOLDER
            if($categoriesOrder == 'byName' || $categoriesOrder == 'byNameReverse'){
                $ctime = $file;
            }
            $results[strtolower($ctime)] = $file;
          }
        }

        closedir($handler);
        if($categoriesOrder == 'byDate' || $categoriesOrder == 'byNameReverse'){
            krsort($results);
        }else if($categoriesOrder == 'byDateReverse' || $categoriesOrder == 'byName'){
            ksort($results);
        }else if($categoriesOrder == 'random'){
            shuffle($results);
        }
        
        return $results;
  }

  function getImagesList ($directory) {
    global $imgTypes;
    global $imagesOrder;

    if( !is_dir($directory)){
      return array();
    }

    $results = array();

    $handler = opendir($directory);

    while ($file = readdir($handler)) {
      if ($file != "." && $file != ".." && $file != ".DS_Store") {
         $extension = preg_split('/\./',$file);
         $extension = strtolower($extension[count($extension)-1]);
         
         if(array_search($extension,$imgTypes) !== FALSE){
            $ctime = filemtime($directory .'/'. $file) . ',' . $file; //BRING THE DATE OF THE IMAGE
            if($imagesOrder == 'byName' || $imagesOrder == 'byNameReverse'){
                $ctime = $file;
            }
            $results[strtolower($ctime)] = $file;
         }   
            
      }
    }

    closedir($handler);
    if($imagesOrder == 'byDate' || $imagesOrder == 'byNameReverse'){
        krsort($results);
    }else if($imagesOrder == 'byDateReverse' || $imagesOrder == 'byName'){
        ksort($results);
    }else if($imagesOrder == 'random'){
        shuffle($results);
    }
    return $results;
  }

  function fixArray($list, $directory){

      $return = array();

      foreach ($list as $key => $value) {

            $thumb = 'no';
            if( file_exists( $directory.'/thumbnails'.'/'.$value ) ){//VERIFY IF THERE IS ANY THUMBNAIL FOR THE IMAGE
              $thumb = 'yes';
            }            

            //CUSTOMIZATION-->
            $values = array();
            $values["thumb"] = $thumb;
            $values["order"] = $key;

            $return[$value] = $values;
      }

      return $return;
  }

  $directory = $_GET['directory'];

  //THE RESULT OF THE JSON CALL
  $output = array();
  
  //GET THE CATEGORIES
  $folders = getFoldersList($directory);

  //GET THE IMAGES IN ROOT
  $imagesInRoot = getImagesList($directory);

  //ADD THE IMAGES IN ROOT
  $output['All'] = fixArray($imagesInRoot, $directory);

  //GET THE IMAGES OF EACH CATEGORY
  foreach ($folders as $key => $value) {
      
      $images = getImagesList($directory."/".$value);

      //ADD THE IMAGES OF EACH CATEGORY
      $output[$value] = fixArray($images, $directory.'/'.$value);
  }

  //print_r($output);
  
  //echo json_encode($output, JSON_FORCE_OBJECT); // If you are using PHP 5.3 please use this line instead of the one below

  echo json_encode($output); 


