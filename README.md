# mesh-to-splat-prototype



Small Node.js experiment to convert a mesh file (`.glb` / `.gltf`) into a Gaussian Splat-style `.ply` file.



The idea is simple: instead of training a full 3D Gaussian Splatting model from images, this script samples points directly on the surface of a mesh and turns them into small oriented Gaussians. The result is not meant to be photorealistic. It is mainly useful for testing a mesh-to-splat pipeline, experimenting with Spark-compatible PLY files, and later trying RAD generation.



## What this project does



Given a mesh, the converter:



* reads mesh primitives from a `.glb` or `.gltf` file;

* extracts positions, normals, colors, UVs and material color/texture when available;

* converts mesh primitives into triangles;

* samples points on triangle surfaces;

* assigns each sampled point a color, opacity, scale and rotation;

* writes the result as a Gaussian Splat-style PLY file.



The output PLY contains the fields expected by common Gaussian Splat loaders:



```text

x y z

nx ny nz

f\_dc\_0 f\_dc\_1 f\_dc\_2

opacity

scale\_0 scale\_1 scale\_2

rot\_0 rot\_1 rot\_2 rot\_3

```



By default, the file is written as binary little-endian PLY because this is the format expected by Spark.



## What this project is not



This is not a trained 3DGS reconstruction.



It does not optimize Gaussians from images, camera poses, or view-dependent appearance. It only uses the input mesh geometry and the colors available in the asset. The result is closer to a surface-based splat approximation than to a photorealistic Gaussian Splatting scene.



## Install



```bash

npm install

```



## Usage



```bash

node src/meshToSplat.js input.glb output.ply --maxSplats 50000 --opacity 2.0 --radiusFactor 1.0

```



Example:



```bash

node src/meshToSplat.js samples/model.glb samples/model.ply --maxSplats 100000 --opacity 4.0 --radiusFactor 2.0

```



## Options



| Option           | Description                                      | Default  |

| ---------------- | ------------------------------------------------ | -------- |

| `--maxSplats`    | Target number of splats to generate              | `50000`  |

| `--opacity`      | Opacity value written to each Gaussian           | `2.0`    |

| `--radiusFactor` | Multiplier applied to the estimated splat radius | `1.0`    |

| `--format`       | Output format: `binary` or `ascii`               | `binary` |



`ascii` is useful for debugging, but Spark/HERA preview expects binary PLY.



## How the conversion works



For each triangle, the script computes its surface area. The total splat budget is then distributed over the triangles according to their area.



For each generated splat:



1\. A random point is sampled on the triangle using barycentric coordinates.

2\. The normal is interpolated when vertex normals exist, otherwise the face normal is used.

3\. The color is taken from the texture, vertex color, material base color, or a default gray.

4\. A radius is estimated from the area covered by the splat.

5\. A quaternion is computed so the Gaussian is aligned with the surface normal.

6\. The splat is written to the output PLY.



## Notes about quality



The visual quality depends a lot on the parameters.



A low splat count may produce a sparse or transparent-looking result. Increasing `--maxSplats` usually improves coverage, while increasing `--radiusFactor` makes the surface look fuller but can also make it blurrier.



For a dense mesh, values like this can give a better preview:



```bash

node src/meshToSplat.js input.glb output.ply --maxSplats 300000 --opacity 5.0 --radiusFactor 2.0

```



This is still only a geometric approximation. It should not be compared directly with a real trained 3DGS model.



## Project structure



```text

src/

&#x20; math.js

&#x20; meshToSplat.js

&#x20; texture.js

&#x20; writeGaussianPly.js



samples/

&#x20; README.md

```



Generated `.ply`, `.glb`, and `.gltf` files are intentionally ignored by Git.



## Possible next steps



* test the generated PLY with Spark;

* run Spark `build-lod` on the PLY to generate RAD;

* compare direct PLY loading with RAD loading;

* improve sampling to reduce holes and noise;

* estimate splat radius from local neighborhood density instead of triangle area only.



