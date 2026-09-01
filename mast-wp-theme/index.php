<?php
/**
 * Fallback template for posts, pages, archives, and 404s.
 *
 * @package MAST
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>

<section class="mast-section">
	<div class="container page-body">
		<?php if ( have_posts() ) : ?>
			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<article <?php post_class(); ?>>
					<h1><?php the_title(); ?></h1>
					<?php the_content(); ?>
				</article>
				<?php
			endwhile;

			the_posts_pagination();
			?>
		<?php else : ?>
			<h1><?php esc_html_e( 'Nothing found', 'mast' ); ?></h1>
			<p>
				<?php esc_html_e( 'That page does not exist.', 'mast' ); ?>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back to MAST Solutions →', 'mast' ); ?></a>
			</p>
		<?php endif; ?>
	</div>
</section>

<?php
get_footer();
