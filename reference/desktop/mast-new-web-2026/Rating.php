<?php
/**
 * Rating's Template
 * @version 2.1.0
 */

global $product;
$averange_rating= $product->get_rating_html();
$rating_count= $product->get_rating_count();
$rating = $product->get_average_rating();

?>
<div class="rating-single-product" itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating">
    <?php
    // if we have some rating we'll show the div content.
    if ($averange_rating!=''){
        echo $averange_rating ." <span class='rating-text'> <span itemprop='reviewCount'>".$rating_count." </span>". _n("REVIEW","REVIEWS",$rating_count,"yit")." </span>";
    }
    ?>
    <meta itemprop="ratingValue" content="<?php echo $rating; ?>" />
</div>
<div class="clearfix"></div>

